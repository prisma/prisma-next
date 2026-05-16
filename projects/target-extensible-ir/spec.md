# Summary

Prisma Next's Contract IR and Schema IR are flat data shapes (`type = { ... }`) consumed by framework code that imports their concrete types directly. There is no honest seam through which a target can introduce IR concepts that don't exist in other targets — Postgres schemas, MySQL databases, future RLS policies, target-specific functions and enums all have to wedge themselves in through opaque `annotations.pg` payloads or be left out of the IR entirely. This project flips both Contract IR and Schema IR to a polymorphic class hierarchy modelled on the existing migration-op IR (ADR 195) and Mongo Schema IR, layered as **framework interfaces → family abstract bases → target concrete classes**, with domain operations (verification, hydration, planning) following the same layering pattern. As the canonical demonstration that the new architecture works, **Namespace** is introduced as a first-class framework concept with target concretions (Postgres `schema`) and a `__unbound__` IR sentinel for the late-bound slot (resolved at connection time via target-specific mechanisms; opted into explicitly via PSL `namespace unbound { … }`).

> **Reader note — PR1 vs PR2 split.** This spec is canonical for the whole project but the project delivers across two PRs (see [`plan.md § Delivery sequencing`](plan.md#delivery-sequencing--split-into-two-prs)). **PR1 (this branch)** ships the IR convention end-to-end on the SQL family + Mongo family, the entities authoring mechanism, and the enum exemplar (everything anchored on M1-M4 + M3.5). **PR2 (umbrella [TML-2520](https://linear.app/prisma-company/issue/TML-2520))** ships the namespace exemplar (M5a + M5b) including the IR rename (`__unspecified__` → `__unbound__` at the IR layer; PSL AST retains `__unspecified__` for the syntactic-absence bucket — see FR14), the authoring DSL surface, multi-namespace contracts, multi-tenancy via explicit `namespace unbound { … }` PSL opt-in, cross-namespace FK references, and the `ForeignKey` IR restructuring (source/target separation; `ForeignKeyReferences` → `ForeignKeyReference` rename). Everything in this spec that names the namespace concept, multi-tenancy, cross-namespace FKs, or the authoring DSL for namespaces lands in PR2, not PR1. Acceptance criteria explicitly call out which PR closes each (AC1, AC2, AC7, AC8, AC9, AC10, AC11, AC12 in PR1; AC4, AC4a, AC5, AC6 in PR2).

# Context

## At a glance

Today's Contract IR for a Postgres user table looks like this on disk and in memory — flat data, indistinguishable from any other SQL target:

```jsonc
// contract.json (today)
{
  "target": "postgres",
  "storage": {
    "tables": {
      "User": {
        "columns": {
          "id": { "nativeType": "uuid", "nullable": false },
          "email": { "nativeType": "text", "nullable": false }
        },
        "primaryKey": { "columns": ["id"] }
      }
    }
  }
}
```

Framework consumers — verifier, planner, introspector, the migration tooling, the CLI — walk this shape by `import`-ing concrete types like `StorageTable`, `SqlSchemaIR`, `SqlForeignKeyIR` and treating their fields as data. There is no polymorphism, no extension hook beyond `annotations: SqlAnnotations` (an untyped `Record<string, unknown>`), and no way for a Postgres-specific concept like a schema (namespace) to enter the IR without making the framework Postgres-aware.

This project keeps the on-disk JSON shape canonical but flips the in-memory IR to a class hierarchy that round-trips through JSON via plain JSON-clean fields, kind discriminants, and target-owned hydration — the same pattern proven by `OpFactoryCall` (ADR 195) and `MongoSchemaIR`. Each IR is layered:

```text
Framework (1-framework/)
  interface IRNode                              // bare alphabet: { kind?: string }
  abstract class IRNodeBase                     // centralised freeze affordance for subclasses
    implements IRNode
  interface Namespace                           // first-class building block
  abstract class NamespaceBase                  // convenience for implementers
  interface Storage { namespaces: Record<...> } // framework promise: every IR has namespaces
  interface SchemaVerifier<TContract, TSchema>  // domain operation SPI
  interface ContractSerializer<TContract>       // round-trip SPI: deserializeContract + serializeContract

Family (2-sql/, 2-mongo-family/)
  abstract class SqlNode extends IRNodeBase               // SQL alphabet shape (IR node base)
  abstract class SqlTable extends SqlNode                 // family abstract base for IR nodes
  abstract class SqlStorage implements Storage           // adds family-shape fields (tables, …)
  abstract class SqlContractSerializerBase                // family abstract base per SPI
    implements ContractSerializer<…>
  abstract class SqlSchemaVerifierBase                    // family abstract base per SPI
    implements SchemaVerifier<…, …>

Target (3-targets/postgres/, 3-targets/sqlite/, 3-mongo-target/)
  class PostgresSchema extends NamespaceBase              // target concretion of framework concept
  class PostgresTable extends SqlTable                    // target concretion of family abstract
  class PostgresRlsPolicy extends IRNodeBase              // target-only kind, no family parent
  class PostgresContractSerializer                        // concrete SPI implementer
    extends SqlContractSerializerBase
  class PostgresSchemaVerifier                            // concrete SPI implementer
    extends SqlSchemaVerifierBase

  // The existing target descriptor pattern (today's `SqlControlTargetDescriptor`,
  // `RuntimeTargetDescriptor`, etc.) grows new properties carrying the IR-time SPI
  // instances. There is no separate `Target<TContract, TSchema>` aggregator — the
  // descriptor IS the aggregator.
  const postgresControlTargetDescriptor: SqlControlTargetDescriptor<'postgres', …> = {
    ...postgresTargetDescriptorMeta,
    migrations:         { createPlanner, createRunner, contractToSchema },  // existing
    contractSerializer: new PostgresContractSerializer(…),                  // new (this project)
    schemaVerifier:     new PostgresSchemaVerifier(…),                      // new (this project)
  };
```

Targets concretize family abstract classes for IR nodes and add IR node kinds with no family-level counterpart. For **domain operations** (verification, hydration, future planning), each SPI is its own class hierarchy — framework SPI interface, per-SPI family abstract base, concrete target SPI implementer. Implementer instances are exposed as named properties on the **existing target descriptor** (`postgresControlTargetDescriptor.contractSerializer`, `…schemaVerifier`, alongside the existing `…migrations.*`). The IR-time SPIs introduced by this project slot in next to the control-plane SPIs already there; no new aggregator interface is invented. Framework consumers depend on the framework SPI interfaces (`ContractSerializer<TContract>`, `SchemaVerifier<TContract, TSchema>`), never on the concrete target SPI classes. Extension/target authors who want to tweak one SPI subclass that one SPI implementer (`class CockroachContractSerializer extends PostgresContractSerializer`) and inject it into their descriptor, without touching the others.

### Authoring surface

The IR refactor unlocks new authoring surfaces for namespaces and cross-namespace foreign keys. **PSL gains a single new top-level form — the `namespace` block — and reuses the existing `@relation` mechanism for cross-namespace FKs via dot-qualified type references in the type position.** No new attribute is required.

```prisma
// schema.psl

namespace auth {
  model User {
    id    String @id @default(uuid())
    email String
  }
}

namespace public {
  model Profile {
    id     String @id @default(uuid())
    userId String    @unique
    user   auth.User @relation(fields: [userId], references: [id])
  }
}

// Backward compatible: top-level models without a namespace block
// stay valid; the framework parser collects them into the implicit
// `__unspecified__` AST entry. Each target's interpreter then maps
// that entry to its own default slot (Postgres: `public`).
model LegacyThing {
  id Int @id
}
```

Four properties of the design are load-bearing:

- **`namespace` blocks** group models, enums, composite types, and `types` blocks under a named namespace. The blocks themselves live at the top level only — namespaces do **not** recursively nest inside other namespaces (`namespace a { namespace b { … } }` is a parse error). This mirrors the database reality: Postgres schemas, MySQL databases, and Mongo databases are flat.
- **Reopenable blocks.** Multiple `namespace foo { … }` blocks merge into one namespace, letting users split a namespace across logical sections of a contract (or across files in a multi-file contract).
- **Cross-namespace FKs use dot-qualified type references** (`auth.User` in the type position). The `@relation` attribute is unchanged; `references:` continues to take plain column names because the parser knows which model the columns belong to from the type position.
- **Per-target PSL → IR lowering.** The framework parser is purely syntactic — `unbound`, `public`, `auth` are all just identifiers to it. Each target's PSL interpreter (existing per-family packages) maps the AST to IR slots per its semantics. Postgres lowers the implicit `__unspecified__` AST entry to the IR `public` slot (single-tenant behaviour preserved); maps explicit `namespace unbound { … }` blocks to the IR `__unbound__` slot (late binding via `search_path`); maps named blocks (`auth`, `foo`, …) to IR named schemas. SQLite and Mongo reject all explicit `namespace { … }` blocks today; their interpreters accept only the implicit `__unspecified__` entry and lower it to their singleton / connection-bound slot. The PSL AST identifier `__unspecified__` (the framework parser's name for the syntactic-absence bucket) and the IR sentinel `__unbound__` are deliberately distinct — they describe different concepts at different layers.

The TS builder surface is kept structurally parallel: `defineContract`'s config gains a `namespaces` declaration list, `model(name, config)` accepts a per-model `namespace` field, and **existing FK call sites need no new syntax** — the model handle returned by `model(...)` carries its namespace coordinate, so `constraints.foreignKey(cols.userId, User.refs.id, …)` and `rel.belongsTo(User, …)` automatically lower to cross-namespace IR when the referenced model lives in a different namespace. The asymmetry vs PSL is mechanical: TS already has variables to carry the namespace, so the dot-qualifier isn't needed; PSL needs the in-source coordinate.

Cross-*contract-space* references (between contracts, not between namespaces in one contract) are out of scope for this project and deferred to follow-up work.

### Pack-contributed entity construction

A target-extensible IR is only as extensible as the builders that construct it. Once the IR admits target-specific kinds (`PostgresEnumType`, `PostgresSchema`, future `PostgresRlsPolicy`, future `PostgresView`), the contract authoring surface needs a corresponding extension point so target packs can ship those kinds without hand-edited family-layer construction sites. This project ships that extension point as a new **`entityTypes`** namespace on `AuthoringContributions`, mirroring the existing pack-bag-driven `field` and `type` namespaces ([`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`](../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts)) and the `composed-authoring-helpers.ts` type narrowing scaffolding ([`packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts`](../../packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts), lifted to a family-agnostic location as part of this work).

**Top-level placement, by symmetry with built-in entities.** Built-in top-level entities (`model`, `rel`) sit at top level on the helpers object. Pack-contributed top-level entities (`enum` today; `namespace` / `policy` / `role` / `view` in PR2 and beyond) sit at top level alongside them — `helpers.enum(...)` rather than `helpers.entities.enum(...)`. The contribution surface (`AuthoringContributions.entityTypes`) names the *kinds of entity* a pack contributes; the user-facing helpers surface flattens those contributions onto top level so contributed and built-in entities are grammatically indistinguishable from the contract author's vantage point. The two surfaces use altitude-appropriate vocabulary — packs ship `entityTypes` (the contribution data structure), users construct entities by name at top level — but the asymmetry is structural (contribution-side namespace vs user-side flat surface), not a deliberate naming opposition. The composed-helpers template performs the contribution-data-structure → top-level-helper rename in the type system; no runtime cost. Surfaced as a typology hole during PR1 review (architect SDR § 3.1); resolved in M7 with the `entityTypes` rename, and refined in M9 R2b with the top-level helpers flatten.

**Vocabulary.** The word "entity" carries three distinct meanings in the codebase that share the term without conflict:

- **Visualisation discriminant** — `SchemaNodeKind = 'entity'` in [`control-schema-view.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-schema-view.ts), used by CLI rendering to tag a schema-node as a top-level entity for layout.
- **Contribution-kind namespace** (introduced here) — the `entityTypes` namespace on `AuthoringContributions`, naming *kinds* of contract-authoring-domain entities packs can contribute (models, namespaces, enums, future RLS policies, roles, views).
- **Application-domain instance** — the user's authored `User`, `Invoice`, `Product` — *instances of* the kinds packs contribute. These are the entities the user's application is *about*.

The contribution-kind namespace is meta-level: packs ship `entityTypes.namespace`, `entityTypes.enum`, `entityTypes.policy` (kinds); users author `User`, `Invoice`, `Profile` (instances).

**Contribution shape.** Every entity contribution is a descriptor with two parts: a **schema** (the PSL/TS lowest-common-denominator description of the contribution's input shape) and an **output mechanism** that is either a declarative template (preferred where expressible — mirrors today's `AuthoringTemplateValue`-shaped outputs on `field` / `type` contributions) or a **factory function** (for outputs that can't be templated — IR-class instances that carry methods, freeze semantics, and per-class identity). The factory mirrors the existing codec-descriptor pattern (`codecDescriptors[].factory` on pack refs); pack refs already carry runtime factories alongside JSON-shaped descriptors. The factory takes validated input (matching the descriptor's schema) and returns an IR-class instance ready to embed in the contract IR.

> _Illustrative — exact API surface up to the implementer:_
>
> ```ts
> // pack contribution surface
> const postgresPack: TargetPackRef<'sql', 'postgres'> = {
>   …,
>   authoring: {
>     entityTypes: {
>       enum: {
>         kind: 'entity',
>         schema: type({ name: 'string', values: 'string[]' }),
>         output: { factory: (input, ctx) => new PostgresEnumType(input) },
>       },
>     },
>   },
> };
>
> // user authoring surface (TS DSL)
> const Status = helpers.enum({ name: 'Status', values: ['active', 'archived'] });
> // → constructs a PostgresEnumType instance via the factory; type narrowing surfaces
> //   `helpers.enum` (top-level alongside `helpers.model` / `helpers.rel`) because
> //   the postgresPack ref appears in the contract's pack list
>
> // user authoring surface (PSL)
> //   the same descriptor's `schema` lowers PSL `enum Status { active archived }` declarations
> //   through the same factory path; no parallel PSL-only contribution
> ```

**Single contribution surface for both authoring runtimes.** The `schema` lowers PSL syntax (`enum Status { … }`, `namespace public { … }`); the same `output` (template or factory) constructs the IR-class instance regardless of which runtime initiated the call. This avoids the historical drift where TS DSL extensions could express things PSL extensions could not, by forcing every contribution through the lowest-common-denominator schema shape.

**Pack-bag-driven type narrowing.** The contract user passes a list of packs to `defineContract`; the resulting top-level entity helpers (`helpers.enum`, `helpers.namespace`, …) are a typed merge of all entity contributions from all packs in the list, narrowed via the same `MergeExtensionXxx<Packs>` + `UnionToIntersection` template that today merges `field`, `type`, codec, and SQL index contributions. Type narrowing is symmetric with declarative-template contributions; only the dispatch at *use* time differs (factory invocation vs template evaluation).

**Where this lands.** The mechanism is shipped in M3.5 (after Postgres SPI shells, before the enum exemplar). The two structural exemplars (M4 enum, M5a/b namespace) are the first real consumers — enum proves the "lift target-specific glue into a pack contribution" path; namespace proves the "introduce a new framework-level kind via a pack contribution" path. Postgres-domain entities (RLS policies, roles, views) are real-world consumers of the same mechanism but are explicitly out of scope per Non-goals; they ship in a follow-on project on the proven mechanism. **Sub-builder / mid-chain extension** (e.g. extending `ScalarFieldBuilder` so packs can contribute `.encrypted()` at chain positions — the *attribute* contribution surface in the entity / attribute / relationship vocabulary) is also out of scope; admitted to the roadmap when a use case demands it. The descriptor + factory shape backport to the existing `field` and `type` namespaces is a mechanical follow-up tracked separately as [TML-2513](https://linear.app/prisma-company/issue/TML-2513).

## Problem

Five concrete pain points motivate this project:

**1. Target-specific concepts can't enter the IR.** Postgres schemas (namespaces), RLS policies, custom functions, custom operators, MySQL databases, SQLite's lack of namespacing — none of these have a typed home in today's IR. They either get dropped (the IR pretends they don't exist), get smuggled through `annotations: SqlAnnotations` (opaque, lossy, no type safety), or force the family layer to absorb target specifics (which leaks Postgres-isms into SQL-family code that other targets have to ignore). The `databaseDependencies.init` escape hatch exists partly because there's no honest place to declare "this is part of my IR" for anything beyond what the family alphabet already covers.

**2. Framework consumers walk concrete IR shapes.** `verifySqlSchema` lives in `family-sql` and imports `SqlTableIR`, `SqlForeignKeyIR`, `SqlIndexIR` directly, walking them with `Object.entries`/property reads. The walk has no extension point: a target adding a node kind has nowhere to put the dispatch. The verifier's only target-specific surface today is a handful of normalizer hooks (`normalizeDefault`, `normalizeNativeType`) and codec control hooks — fine for stylistic dialect differences, useless for structural extension.

**3. Mongo's IR is half-refactored.** `MongoSchemaIR`, `MongoSchemaCollection`, etc., already follow the abstract-class + visitor pattern (`MongoSchemaNode` + `MongoSchemaVisitor<R>`). But Mongo's Contract IR is still flat data, and the family/target distinction is collapsed because Mongo has one target. A family-then-target split deferred is a future migration that will be harder when MongoDB Atlas-specific or legacy-Mongo-driver-specific concepts need their own IR shape.

**4. The same architectural problem keeps recurring.** ADR 195's `OpFactoryCall` solved this for the migration-op layer (framework interface, target abstract base, target concrete classes, target-owned union, JSON-clean fields). Mongo's Schema IR solved the AST shape for one family. Each successful application has been ad-hoc; the codebase doesn't yet have a stated convention for "every domain interface that crosses target boundaries follows this recipe." This project codifies the convention and applies it consistently to the IR layer.

**5. The IR pattern needs first-class structural concepts to demonstrate it end-to-end.** A target-extensible IR refactor with no exemplar concept lands as a structural change with nothing observable to verify it. This project ships two exemplars — one a *refactor of an existing hacked solution* (enums, currently glued in via codec control hooks), one a *new first-class concept* (Namespace). Together they exercise both the "lift target-specific glue into the IR" and "introduce a new framework-level concept" sides of the pattern, and they sequence naturally: enums first, namespace second (see § "Two structural exemplars" below).

## Approach

### Reference implementations in the codebase

The recipe this project codifies is **already proven** in the codebase across several IR layers — this project is consolidating the convention and applying it to the two IRs that haven't yet adopted it (SQL Schema IR + both Contract IRs). Implementers should read these reference files **before** writing new code; they are the canonical templates for shape, naming, freezing, JSON-cleanness, and visitor-vs-method dispatch.

| Reference | What it demonstrates | Why this project points at it |
|-----------|----------------------|-------------------------------|
| [`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts) | Framework interface (`OpFactoryCall` — 3 readonly fields, no methods) implemented by a target abstract base (`PostgresOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall`) extended by ~20 concrete `*Call` classes. Each concrete class: literal-arg constructor, computed `label`, `freeze()` in constructor, `factoryName` as kind discriminant, `toOp()` lowering, `renderTypeScript()` for JSON-isomorphic source emission. Discriminated union (`PostgresOpFactoryCall`) exported as the target's IR alphabet. | The cleanest end-to-end template for "framework declares the interface, target ships the abstract base + concrete classes + union." Implementers should mirror this shape for `PostgresContractStorage` / `PostgresSqlSchemaIR`. |
| [`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts) | The exact same recipe applied to Mongo. Same framework `OpFactoryCall` interface, parallel target abstract base, parallel concrete-class union (`OpFactoryCall` for Mongo). | Confirms the recipe is target-portable. Implementers writing the Mongo Contract IR refactor mirror this shape. |
| [`packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts`](../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts) (and siblings: `schema-ir.ts`, `schema-collection.ts`, `schema-index.ts`, `schema-validator.ts`, `schema-collection-options.ts`, `visitor.ts`) | The AST-class shape for a schema IR: abstract base (`MongoSchemaNode`) with `kind: string` + `accept<R>(visitor: MongoSchemaVisitor<R>): R` + `freeze()`, concrete classes per node kind, visitor interface for narrow-op exhaustive dispatch. Currently family-level (Mongo has one target, so the family/target distinction collapses). | The closest existing analog for the SQL Schema IR refactor. Implementers writing `SqlSchemaNode` / `PostgresTable` / `PostgresColumn` mirror this shape, but at the framework + family + target layering this project introduces. The Mongo IR itself is also being lifted into the 3-layer split as part of this work. |
| [`packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts`](../../packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts) | Abstract base (`MongoFilterExpression`) with **two** consumer interfaces over the same AST: `accept<R>(visitor)` for read-only walks (e.g. lowering, diagnostics) and `rewrite(rewriter)` for transforming walks. Brand-tagged for runtime safety. Concrete classes per filter kind; static factory methods for ergonomic construction. | The reference for "the same AST is consumed by multiple operations, each via its own typed interface." Demonstrates how Schema IR can support a visitor for narrow ops *and* a verifier as a custom domain interface without conflict. |
| [`packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts`](../../packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts), [`stages.ts`](../../packages/2-mongo-family/4-query/query-ast/src/stages.ts), [`packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts`](../../packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts) | Same recipe applied to aggregation expressions, query stages, and wire-protocol commands respectively. Each is its own AST with its own visitor; all follow the abstract-base + frozen-concrete + kind-discriminant + accept-visitor pattern. | Confirms the convention is already pervasive in the Mongo family. Implementers can read whichever is closest to their immediate task. |
| [`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts) (specifically the `OpFactoryCall` interface) | The framework-level interface side of the recipe: bare, three readonly fields (`factoryName`, `operationClass`, `label`), no methods. The framework commits to the minimum needed for the consumer; the target holds all polymorphism. | The reference for how thin the framework interface should be. Implementers writing `SchemaNode`, `Namespace`, `SchemaVerifier` etc. should pattern the framework declarations on this — declare the minimum, push specifics to the target. |
| [ADR 185 — SPI types live at the lowest consuming layer](../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) and the `EmissionSpi` it documents (`packages/1-framework/1-core/framework-components/src/emission/`) | Dependency inversion in production: lower-layer code (the emitter, tooling layer) defines and **calls** an interface; higher-layer code (`sqlEmission`, `mongoEmission`) **implements** it. The interface lives in the lowest layer whose types it depends on. Both caller and implementers depend on the abstraction, never on each other. | The framework-level pattern reference for verifier, hydrator, and any other domain operation this project introduces. The verifier interface should follow the same shape as `EmissionSpi`: declared in `framework-components`, imported by both the family-level orchestrator (verify aggregate, dispatch per space) and the target-level implementer (concrete verifier walking target-extended IR). The ADR also captures *where* such SPI types live in the layer stack — useful when deciding whether `SchemaVerifier` lives in framework-components, sql-family, or somewhere in between. |

The verifier-as-domain-interface pattern (§ "Domain interfaces follow the same layering" below) does not yet have a verifier-shaped reference implementation in the codebase — today's `verifySqlSchema` is a pure family-level function, the artefact this project replaces. But the dependency-inversion *shape* the verifier needs is exactly `EmissionSpi`'s shape (last row above). The implementer applies that shape to a different domain operation; the structural recipe — interface in framework, abstract base in family, concrete in target — is the same.

### Three-layer polymorphic IR

Both Contract IR and Schema IR adopt the following layering, applied to every IR concept that is not strictly framework-internal (see [IR layering — what lives where](#ir-layering--what-lives-where) for the layer-by-layer breakdown):

- **Framework layer**: declares interfaces (`SchemaNode`, `Namespace`, `Storage`, `SchemaIR`) and provides convenience abstract base classes (`NamespaceBase`, `SchemaNodeBase`). Holds the cross-database mental model — Prisma Next's promise that learning the IR for one target makes you fluent in another.

- **Family layer** (SQL, Document/Mongo, …): refines the framework alphabet for the family shape. SQL: `SqlNode`, `SqlTable`, `SqlColumn`, `SqlForeignKey`, `SqlIndex`, `SqlPrimaryKey`, `SqlUnique` — abstract enough that targets concretize. Family also owns shared verification/planning predicates as plain utility functions (`isUniqueConstraintSatisfied`, column-equality helpers, etc.).

- **Target layer** (Postgres, SQLite, Mongo, …): ships concrete classes specializing family abstract bases (`PostgresColumn extends SqlColumn` carrying `nativeType` and default-rendering specifics; `SqlitePragmaIndex extends SqlIndex` carrying SQLite-specific WHERE clause shape) **plus target-only kinds with no family parent** (`PostgresSchema`, `PostgresFunction`, `PostgresEnum`, future `PostgresRlsPolicy`). Owns the verifier, planner, introspector — they walk the target's concrete classes natively, no framework-imposed abstraction barrier inside the target.

Each layer extends the previous via interfaces + (where useful) abstract base classes. Interfaces are the consumer contract; **consumers always depend on framework SPI interfaces, never on concrete target classes**. For IR nodes (tables, columns, foreign keys, etc.), family abstract base classes carry shared structural fields and kind discriminants — the IR-tree shape benefits from inheritance, and an abstract `SchemaNodeBase implements SchemaNode` in the framework centralises the freeze-and-assign pattern that every concrete IR node uses today (already proven on the AST hierarchies in `OpFactoryCall` and `MongoSchemaNode`). For domain operations (verification, hydration, future planning), each SPI is its own class hierarchy: the framework declares the SPI interface, the family ships a per-SPI abstract base (`SqlContractSerializerBase`, `SqlSchemaVerifierBase`) carrying SQL-shared walk logic and exposing protected hooks, and the target ships a concrete SPI implementer per SPI. Implementer instances are exposed as named properties on the **existing target descriptor** — keeping each SPI implementer focused (single inheritance, one concern) and the descriptor itself thin as the framework adds new SPIs (one new descriptor property per SPI). Targets that don't fit the family scaffolding for a given SPI can implement the framework interface directly and skip the abstract base entirely.

### Domain interfaces follow the same layering

Verification, hydration, planning, and any other operation that walks the IR follow the same recipe: the framework defines the SPI interface; the family ships a per-SPI abstract base carrying shared walk logic and protected hooks; the target ships a concrete SPI implementer extending the family base. Implementer instances are exposed as **named properties on the existing target descriptor** (today's `SqlControlTargetDescriptor`, `RuntimeTargetDescriptor`, etc.) — the descriptor pattern that already aggregates control-plane SPIs is the seam new SPIs slot into. Consumers depend on the framework SPI interface they need, never on the concrete target SPI class.

The existing target descriptor (read [`packages/3-targets/3-targets/postgres/src/exports/control.ts`](../../packages/3-targets/3-targets/postgres/src/exports/control.ts) and [`packages/1-framework/1-core/framework-components/src/control/control-instances.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-instances.ts) before writing code) carries `migrations: { createPlanner, createRunner, contractToSchema }` today. This project adds two more named properties next to `migrations`: `contractSerializer` and `schemaVerifier`. No new aggregator interface, no `Target<TContract, TSchema>` type — the descriptor IS the aggregator.

> _Illustrative — exact method shapes and generic parameters are up to the implementer:_
>
> ```ts
> // 1-framework/... (new SPI interfaces only; no new aggregator)
> interface SchemaVerifier<TContract, TSchema> {
>   verifySchema(opts: { contract: TContract; schema: TSchema; ... }): VerifyResult;
> }
> interface ContractSerializer<TContract> {
>   deserializeContract(json: unknown): TContract;
>   serializeContract(contract: TContract): JsonObject;  // canonical JSON shape
> }
>
> // 2-sql/... (per-SPI family abstract bases + utility helpers)
> abstract class SqlContractSerializerBase<TContract>
>   implements ContractSerializer<TContract> {
>   deserializeContract(json: unknown): TContract {
>     const validated = this.parseSqlContractStructure(json);  // shared SQL arktype validation
>     return this.constructTargetContract(validated);          // protected abstract hook
>   }
>   serializeContract(contract: TContract): JsonObject {
>     return contract as unknown as JsonObject;  // class fields are JSON-clean; targets override if a transform is needed
>   }
>   protected abstract constructTargetContract(validated: …): TContract;
> }
>
> abstract class SqlSchemaVerifierBase<TContract, TSchema>
>   implements SchemaVerifier<TContract, TSchema> {
>   verifySchema(opts): VerifyResult {
>     const issues = verifyCommonSqlSchema(opts);              // shared SQL walk helper
>     issues.push(...this.verifyTargetExtensions(opts));       // protected hook
>     return { issues };
>   }
>   protected abstract verifyTargetExtensions(opts): SchemaIssue[];
> }
>
> // 3-targets/postgres/... (concrete SPI implementers + descriptor extension)
> class PostgresContractSerializer extends SqlContractSerializerBase<PostgresContract> {
>   protected constructTargetContract(validated): PostgresContract { … }
> }
>
> class PostgresSchemaVerifier extends SqlSchemaVerifierBase<PostgresContract, SqlSchemaIR> {
>   protected verifyTargetExtensions(opts): SchemaIssue[] {
>     // walk PostgresSchema, PostgresFunction, PostgresEnum, future PostgresRlsPolicy
>   }
> }
>
> // The existing target descriptor grows two new named properties next to `migrations`.
> const postgresControlTargetDescriptor: SqlControlTargetDescriptor<'postgres', …> = {
>   ...postgresTargetDescriptorMeta,
>   migrations: { createPlanner, createRunner, contractToSchema },  // existing
>   contractSerializer: new PostgresContractSerializer(…),          // new (this project)
>   schemaVerifier: new PostgresSchemaVerifier(…),                  // new (this project)
> };
> ```

Domain operations are target-owned because target-specific IR demands target-specific consumers — the family layer cannot meaningfully verify or hydrate a node kind it does not know exists. The framework's role drops to: declare the SPI interfaces, aggregate the contract spaces into a multi-space input, dispatch to the right SPI instance via the descriptor's named property, format the result. Target-specific issue kinds are widened target-side; the existing framework `SchemaIssue` type (in `framework-components/control/control-result-types.ts`) stays as-is for this project. (See § "Forward note: `SchemaIssue` layering" below.)

Adding new SPIs in future projects (planner, introspector, telemetry probe, …) grows the descriptor by one new named property per SPI — no new top-level types, no inheritance shifts. Each SPI implementer remains small, single-concerned, and independently testable. Extension authors who want to swap one SPI's behaviour subclass just that SPI's concrete class (`class CockroachContractSerializer extends PostgresContractSerializer`) and inject the override into their descriptor — no need to absorb the rest of the system to make a focused change.

### Forward note: `SchemaIssue` layering

`SchemaIssue` already exists at [`packages/1-framework/1-core/framework-components/src/control/control-result-types.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-result-types.ts) as a closed union of 21 SQL-shape kinds (`missing_table`, `missing_column`, `type_mismatch`, …). It sits in `framework-components/` but its vocabulary is SQL-flavoured — `missing_collection` doesn't fit, and Mongo verification today works around this. The type is mis-layered: framework-level by package, family-level by content.

This project **does not refactor `SchemaIssue`.** Target-specific issue kinds (RLS-policy-mismatch, namespace-mismatch, future function-shape-mismatch) extend the union target-side; framework consumers continue to see today's shape; target-aware consumers cast. The verifier SPI's framework-level return type does not get a generic over target kinds.

The layering observation is captured here so the implementer of a follow-up project (probably the same person who lands Supabase RLS as an IR kind) knows the issue type's layering is a known forward concern. Out of scope for this project.

### JSON canonical, classes canonical in-memory

Per ADR 192, the on-disk JSON form (`contract.json`, `ops.json`, future `schema.json` if persistence becomes useful) is the canonical artifact. Identity, attestation, auditability, and replay all key off the JSON form. This project does not change that.

What this project does change: the **in-memory** IR becomes a class hierarchy that round-trips through JSON without ceremony. Class fields are JSON-clean by construction (plain readonly properties, kind discriminant, no methods on properties, no `Map`/`Set`, no `Date` objects). `JSON.stringify(contract)` produces canonical contract.json directly; no `toJSON()` method needed. Round-trip in both directions is reached through the descriptor's `ContractSerializer` SPI (see § "Round-trip via `ContractSerializer` SPI" below): the target's serializer deserializes JSON into target-typed class instances and serializes class instances back to canonical JSON shape.

> _Illustrative — exact API surface up to the implementer:_
>
> ```ts
> // round-trip
> const contract: Contract = descriptor.contractSerializer.deserializeContract(json);
> const json: JsonObject = descriptor.contractSerializer.serializeContract(contract);
> // structurally identical to the original; JSON.stringify reads the class fields directly
>
> // Class fields are plain — JSON.stringify reads them directly
> class PostgresColumn extends SqlColumn {
>   readonly kind = 'PostgresColumn' as const;
>   readonly name: string;
>   readonly nativeType: string;
>   readonly nullable: boolean;
>   readonly default?: string;
>   constructor(args: { name: string; nativeType: string; nullable: boolean; default?: string }) {
>     super();
>     // ...assign, freeze
>   }
> }
> ```

### Round-trip via `ContractSerializer` SPI

`ContractSerializer<TContract>` is the framework SPI for moving a contract between its canonical on-disk JSON form and its in-memory class-hierarchy form. The interface covers both directions explicitly so the conceptual seam — "the boundary where the contract crosses between persisted JSON and live class instances" — has a single named home, even though one direction is structurally trivial today.

> _Illustrative — exact API surface up to the implementer:_
>
> ```ts
> // framework
> interface ContractSerializer<TContract> {
>   deserializeContract(json: unknown): TContract;
>   serializeContract(contract: TContract): JsonObject;
> }
>
> // existing target descriptor grows a new named property
> const postgresControlTargetDescriptor: SqlControlTargetDescriptor<'postgres', …> = {
>   ...postgresTargetDescriptorMeta,
>   migrations: { createPlanner, createRunner, contractToSchema },
>   contractSerializer: new PostgresContractSerializer(…),
>   schemaVerifier:     new PostgresSchemaVerifier(…),
> };
>
> // framework-internal call site
> const contract = descriptor.contractSerializer.deserializeContract(json);
> const json     = descriptor.contractSerializer.serializeContract(contract);
> ```

Four properties of this shape are load-bearing:

- **One serializer, both directions.** Deserialization (validate-and-construct) and serialization (canonical JSON shape) are two faces of the same boundary. Naming them as one SPI is honest about that — and the framework needs both faces today, not eventually. Round-trip test infrastructure (every IR refactor relies on `JSON.parse(JSON.stringify(deserialize(json))) ≡ json` to attest equivalence) calls both methods. Future canonicalization needs (ordering keys, dropping computed-only fields, normalizing numeric encodings) land on `serializeContract` without re-plumbing call sites. And the framework's contract-equality story (used by drift detection and contract-vs-introspected diffing) reads canonical JSON, not class instances. For most targets `serializeContract` is identity over JSON-clean class instances today; the method exists because the seam is real, not as a convention placeholder.

- **`serializeContract` returns `JsonObject`.** The framework reaches the SPI's output as opaque JSON-shaped data — it stringifies, hashes, or feeds it back into another SPI. `JsonObject` (the shared workspace type for "structurally JSON-clean object") communicates that contract precisely. Each target then types its own concretion as its specific contract type, narrowing `JsonObject` to the target shape internally.

- **No standalone `validateContract` function.** The previous `validateContract(json)` (and its proposed `validateContract(target, json)` variant) is removed. The name was a misnomer — it performed structural integrity checks, not logical validation, and the misnomer kept tempting contributors to encode logical semantics into it. The post-refactor surface is the SPI method directly: `descriptor.contractSerializer.deserializeContract(json)`. The user-facing facade (`postgres<Contract>(...)`) continues to wrap this so end-users never see the SPI; framework-internal callers reach through the named SPI property explicitly.

- **Typed against the SPI, not the descriptor.** Framework consumers depend on `ContractSerializer<TContract>` directly. Tests that don't exercise serialization satisfy the SPI with stub implementations whose `deserializeContract` is the identity function and whose `serializeContract` returns the input unchanged. The framework ships a `createIdentityContractSerializer<TContract>()` helper for this case so tests don't reinvent the stub. This preserves the ergonomic floor of the test suite — most existing tests construct a contract literal and never round-trip it, and the SPI shape ensures they don't have to acquire serialization logic.

- **Currying-friendly via property capture.** Partial application on the SPI side reads as `const deserialize = descriptor.contractSerializer.deserializeContract.bind(descriptor.contractSerializer)` (or, more idiomatically, `const deserialize = (json) => descriptor.contractSerializer.deserializeContract(json)`). The named-property access is the natural curry boundary; no helper function is needed to expose it.

Every existing `validateContract` call site is migrated to `descriptor.contractSerializer.deserializeContract(json)`. Framework-internal callers usually have a target descriptor in scope already (or can accept one); the migration is mechanical there. Tests pay the largest single share of the cost — most tests construct a contract literal and call `validateContract`, so each test acquires either a real target descriptor import or `createIdentityContractSerializer<TContract>()`. Type inference also improves: the SPI carries `<TContract>` in its static type, so `descriptor.contractSerializer.deserializeContract(json)` infers `TContract` without an explicit type parameter at most call sites; the current `validateContract<Contract>(json)` ceremony — forced because JSON imports lose literal types — drops out.

### Visitor pattern reserved for narrow structural ops

Visitors remain available — and continue to be the right tool — for operations that are inherently kind-narrow and want exhaustive dispatch: pretty-print, diagnostic tree rendering, CLI display. The visitor interface is declared at the layer that owns the kind alphabet (family for the SQL/Mongo shape; target for target-extended visitors that handle target-only kinds). For domain operations that need more context than per-node dispatch can carry — verification, planning, hydration, contract-space aggregation — a custom interface is the right shape, because the operation depends on the *aggregate* of multiple IR trees, dialect-specific normalization, target-richer schema info, and dialect-specific issue taxonomies.

### Two structural exemplars

Two concepts demonstrate the new IR pattern end-to-end. They are sequenced — enums first as a *refactor of an existing hacked solution*, then namespace as a *new first-class concept introduction*. Each exercises a different side of target-extensible IR: the first proves the pattern is workable by replacing existing glue; the second proves the pattern admits new concepts cleanly.

**Exemplar 1: Enums (refactor)**

Enums today are not first-class IR. The user authors an enum as a storage-type instance (`storage.types.<name>`) tied to a `codecId`; verification dispatches via codec control hooks (`codecHooks.verifyType`, `expandNativeType` in `verify-sql-schema.ts`); migration emission has its own per-target enum factories (`createEnumType`, `addEnumValues`, `dropEnumType` in Postgres; analogous glue elsewhere). The current shape works but is a textbook example of the smell this project addresses: a target-specific concept (Postgres `CREATE TYPE … AS ENUM`) shoehorned into a generic codec-hook surface, with verifier and planner each carrying their own custom dispatch.

The refactor lifts enums into the IR proper:

- `abstract class SqlEnumType extends SqlNode` (family base) — declares the enum-shaped data (name, values, namespace).
- `class PostgresEnumType extends SqlEnumType` (target concretion) — Postgres-specific fields, `CREATE TYPE` rendering, native-type-name resolution.
- The verifier walks `SqlEnumType` instances natively; codec hooks drop out of the enum verification path.
- The planner consumes IR nodes directly; the existing `CreateEnumTypeCall` / `AddEnumValuesCall` / `DropEnumTypeCall` `OpFactoryCall` classes line up 1:1.
- Authoring DSL: minor, mostly a re-routing of how enum types lower from the user's `defineContract` to IR nodes.

Enums are the *low-risk first* exemplar because they don't introduce a new concept — they're already in the system. The blast radius is bounded (codec-hook removal for the enum case, planner unchanged at the call layer, authoring API shape preserved). When this milestone lands, the project has a concrete, testable proof that the new IR pattern is workable end-to-end on a real concept, before the namespace work begins.

**Exemplar 2: Namespace (new concept)**

`Namespace` is introduced as a first-class framework-level building block, building on the foundation enums proved out:

- `interface Namespace extends SchemaNode { id: string; ... }` — declared in framework.
- `abstract class NamespaceBase implements Namespace` — convenience for implementers.
- `class PostgresSchema extends NamespaceBase` — target concretion. Carries Postgres-specific fields (search-path semantics, owner role, etc.) and renders to SQL as `"<schema>"`.
- A reserved IR sentinel `id: '__unbound__'` represents the **late-bound slot** — the slot whose physical schema is resolved at connection time via target-specific mechanisms (Postgres `search_path`; per-target equivalents elsewhere). Late binding is an explicit user opt-in (PSL `namespace unbound { … }`), never a default. Targets without late-binding semantics (SQLite, Mongo today) reject explicit opt-in attempts at the interpreter layer.
- **The IR `__unbound__` slot is realised as a target-specific singleton subclass, not a call-site branch.** Each target owning a Namespace concretion ships a singleton subclass — e.g. `class PostgresUnboundSchema extends PostgresSchema` with `readonly id = '__unbound__' as const`. The subclass overrides the namespace's serialization methods (qualified-name rendering, FK-reference DDL emission) to elide the namespace qualifier. Call sites stay polymorphic: `namespace.renderQualified(name)` returns `"users"` for the singleton and `"auth"."users"` for a named schema, with no `if (namespace.id === '__unbound__')` branches anywhere. The framework promises only that every target with late-binding semantics ships exactly one instance of its unbound subclass, accessed via a stable static reference (`PostgresSchema.unbound`).
- SQLite stores models in its singleton namespace slot; emitted SQL has no qualifier in any path. SQLite does not support multi-schema, so any explicit `namespace { … }` PSL block is rejected.
- Mongo's Namespace maps to the **database** (the connection's `db` field provides the binding). All models lower to the connection-`db` slot; explicit `namespace { … }` PSL blocks are rejected today. Mongo ships the namespace concretion in M2 so all families share the same Storage shape from the start; future work can lift the no-blocks restriction if Mongo gains a multi-database use case.

In Contract IR, every storage object (table, enum, function, …) belongs to a namespace. In Schema IR, every introspected object is namespace-scoped. The verifier walks two parallel trees of namespace-scoped objects and matches them up — for the IR `__unbound__` slot, the verifier resolves to `current_schema()` (or the per-target equivalent) at entry and proceeds with concrete-keyed dispatch. FK references carry a namespace coordinate on both sides, so cross-namespace FKs within a single contract space (e.g. `public.profiles.user_id REFERENCES auth.users(id)`) are first-class; the FK reference IR is `(namespace.id, name)` rather than just `name`, and the planner-DDL emit qualifies the `REFERENCES` clause.

The authoring DSL surface for namespaces is part of this project. Both PSL and the TS builder gain a top-level `namespaces` declaration list and a per-model `namespace` field (see FR16a). Cross-namespace FK references require **no new syntax** in either surface (see FR16b): TS reuses the existing `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` / `rel.belongsTo(OtherModel, …)` call sites — the model handle carries its namespace coordinate, so the lowering produces cross-namespace IR automatically when the referenced model lives in a different namespace; PSL reuses the existing `@relation` mechanism with dot-qualified type references (`auth.User @relation(fields: [userId], references: [id])`). Richer namespace ergonomics (namespace-as-module imports, namespace-scoped models, qualified-name shorthand) are out of scope; the basic surface is enough to express multi-schema Postgres contracts including cross-namespace FKs and connection-bound multi-tenancy.

Namespace is the *higher-risk second* exemplar because it introduces a new framework-level concept and changes the keying of every storage object (`Record<name, …>` becomes `Record<(namespace.id, name), …>` in IR walking). It lands after enums so the implementer is operating in a codebase where the new IR pattern has already been proven on a real concept.

**What's deliberately not exemplified**

RLS policies, cross-space FK references, custom functions, custom operators, and Supabase deliverables are out of scope (see Non-goals). Each of them is a future application of the same recipe; the project leaves them to follow-up work once the foundation is in place.

### Codifying the convention

Today's codebase has at least three patterns coexisting:

1. **Frozen-class AST + visitor** (`OpFactoryCall`, `MongoSchemaNode`, `MongoFilterExpression`, query stages, wire commands).
2. **Interface + factory function, classes private** (codified in [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions"; example: `createColumnRegistry`, `createPostgresAdapter`).
3. **Plain data shapes** (`SqlSchemaIR`, `Contract<TStorage>`, the existing IR layer).

The factory-function pattern (#2) is appropriate for **stateful services** (registries, runtimes, adapters) where the consumer holds an opaque handle and the implementation is a hidden closure. It is *not* appropriate for **AST/IR nodes** that need to round-trip through JSON, support polymorphic dispatch, and admit target-specific extension — those want #1. The distinction is about what the type *is* (a service vs. a tree node), not about preferring one pattern over the other globally.

This project surfaces the distinction explicitly. The convention encoded by this project is:

> **Stateful services** (registries, adapters, drivers, runtimes) → interface + factory function; classes private. Pattern reference: `Runtime → createRuntime()`.
>
> **AST/IR nodes and domain operations that cross the framework/target boundary** → framework interface + family abstract base + target concrete classes. Classes are publicly exported as the target's IR alphabet. Pattern reference: `OpFactoryCall`, `MongoSchemaNode`.
>
> **Dependency inversion across layers** → SPI interface in the lowest layer whose types it depends on; both caller and implementer depend on the abstraction. Pattern reference: [ADR 185](../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md), `EmissionSpi`.

Two architectural principles underwrite this convention. Both are part of Prisma Next's promise but are not yet stated explicitly in the architecture docs:

- **The framework provides affordances; targets implement specifics.** The framework's job is to encode behaviour as interfaces, abstract bases, and shape constraints. Targets fill in specifics (rendering, dialect quirks, native types, target-only kinds). This is partly captured today as "Thin core, fat targets" in the Architecture Overview, but the *behaviour-encoding* aspect (framework provides the affordances target authors fall into) is not surfaced.

- **Familiar with one target, fluent in another.** Because every target follows the same framework affordances, a developer who learns Postgres's IR shape reads MySQL's the same way; the verifier interface is the same; the hydrator dispatches the same way; the namespace mental model carries across SQL and Mongo. The framework creates a *pit of success* for target authors — utilize the framework affordances and your target naturally behaves like other targets, creating the common set of expectations users naturally fall into.

Both principles need to land in `docs/Architecture Overview.md` (or the canonical principles location) so they outlive this project. The project's deliverables include capturing them durably (see Documentation deliverables below).

### Documentation deliverables

The work this project ships breaks several existing conventions and introduces new architectural principles. Both need to be reflected in durable documentation, not just in the project's own spec. The following docs/rules are in scope to update as part of this project (timing — during execution vs. at close-out — is a PE-pass decision):

- **`AGENTS.md` / `CLAUDE.md`** (line 93 today): the rule "Interface-Based Design: Export interfaces and factory functions, not classes" is too broad. It should be split into two rules along the service-vs-AST/IR axis described in § "Codifying the convention" — services use the factory-function pattern; AST/IR nodes and domain operations use the framework-interface + abstract-base + concrete-class pattern.

- **[`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md)** § "Interface-Based Design with Factory Functions": the section needs a sibling section "AST/IR Class Hierarchies with Public Class Exports" (or similar) that documents the new convention, references the same examples as the spec's reference-implementations table, and clarifies when each pattern applies.

- **[`docs/Architecture Overview.md`](../../docs/Architecture%20Overview.md)** § "Guiding Principles": "Thin core, fat targets" needs to be enriched (or accompanied by a new principle) to capture (a) "the framework provides affordances; targets implement specifics" and (b) "familiar with one target, fluent in another." See § "Codifying the convention" for the precise wording to encode.

- **ADRs** (deferred to project close-out per the user's call): at least two ADRs come out of this work — one codifying the 3-layer polymorphic IR pattern as a project-wide convention (with the IR-AST recipe, the visitor-vs-domain-interface rule, and the JSON-canonical / class-in-memory round-trip), and one capturing the architectural principles underwriting it (framework affordances + cross-target consistency). Drafts may live under `projects/target-extensible-ir/specs/` during execution and get promoted to `docs/architecture docs/adrs/` at close-out.

- **Subsystem docs** (`docs/architecture docs/subsystems/`): "Data Contract", "Contract Emitter & Types", and "Adapters & Targets" reference today's flat-data IR shape and need updating to reflect the new class hierarchy. "Migration System" references `OpFactoryCall` and is fine; the new IR layer aligns with what's already documented there.

### Mongo migrates to the same 3-layer split

Mongo's existing `MongoSchemaNode` / `MongoSchemaVisitor` AST is migrated to the new layering: framework `SchemaNode` interface at the top; family-Mongo abstract bases (`MongoSchemaCollectionBase`, etc.) refining the framework alphabet for collection-shaped persistence; target-Mongo concrete classes (`MongoTableCollection`, `MongoTimeSeriesCollection`, …) implementing them. Mongo's Contract IR — currently flat data shapes (`MongoIndex`, `MongoIndexOptions`, `MongoCollationOptions`) — flips to the same AST-class pattern that Mongo Schema IR already uses, so both IRs are consistent across the family.

This work lands as part of this project, not later, for two reasons. First, the layering convention is only a convention if it applies consistently across families from the start; deferring Mongo means two IR styles in the codebase indefinitely. Second, the migration is mechanical (Mongo Schema IR is already class-based; Contract IR data shapes are small and have a single consumer surface) and doing it now, while the pattern is fresh, is cheaper than doing it later.

### IR layering — what lives where

The illustrative names below pin shape, not exact identifiers — implementers may pick clearer names. The point is the **layering**: each concept has a framework declaration, a family base, and one or more target concretions.

**SQL family example** (Postgres concretion shown; SQLite mirrors the same structure with simpler concretions):

| Concept                    | Framework layer                              | Family layer (SQL)                          | Target layer (Postgres)                                 |
|----------------------------|----------------------------------------------|---------------------------------------------|---------------------------------------------------------|
| IR node base               | `interface SchemaNode { kind }`, `abstract class SchemaNodeBase implements SchemaNode` (centralised `freeze()` helper) | `abstract class SqlNode extends SchemaNodeBase` | (target-specific concrete classes)                      |
| Storage / contract root    | `interface Storage { namespaces: Record<string, Namespace> }` | `abstract class SqlStorage implements Storage` | `class PostgresStorage extends SqlStorage`         |
| Tables / collections       | —                                            | `abstract class SqlTable extends SqlNode`   | `class PostgresTable extends SqlTable`                  |
| Columns / fields           | —                                            | `abstract class SqlColumn extends SqlNode`  | `class PostgresColumn extends SqlColumn`                |
| Foreign keys               | —                                            | `abstract class SqlForeignKey`              | `class PostgresForeignKey extends SqlForeignKey`        |
| Namespace                  | `interface Namespace`, `abstract class NamespaceBase` | (passes through; SQL uses `NamespaceBase`) | `class PostgresSchema extends NamespaceBase`; `class PostgresUnboundSchema extends PostgresSchema` (late-bound singleton, `id = '__unbound__'`, overrides qualifier emission) |
| Enum (refactor exemplar)   | (none required — family-shape concept)       | `abstract class SqlEnumType extends SqlNode` | `class PostgresEnumType extends SqlEnumType`           |
| Target-only kinds          | (must extend `SchemaNodeBase`)               | (none)                                      | `PostgresFunction`, future `PostgresRlsPolicy`, etc.   |
| Verifier                   | `interface SchemaVerifier<TContract, TSchema>` | `abstract class SqlSchemaVerifierBase` + utility helpers | `class PostgresSchemaVerifier extends SqlSchemaVerifierBase`, exposed as `descriptor.schemaVerifier` |
| Serializer (round-trip)    | `interface ContractSerializer<TContract>` (`deserializeContract` + `serializeContract(): JsonObject`); reached via `descriptor.contractSerializer.<method>(…)` — no standalone `validateContract` function | `abstract class SqlContractSerializerBase` carrying SQL-shared arktype validation + protected hooks | `class PostgresContractSerializer extends SqlContractSerializerBase`, exposed as `descriptor.contractSerializer` |
| SPI aggregation            | (none — no new aggregator interface)         | (none)                                      | The existing `SqlControlTargetDescriptor` grows two new named properties (`contractSerializer`, `schemaVerifier`) next to `migrations` |
| Visitor (narrow ops)       | (none — visitor scope is domain-specific)    | `interface SqlSchemaVisitor<R>` for family-known kinds | Optional target-extended visitor `PostgresSchemaVisitor<R>` |

**Mongo family example** (lifted from today's family-level AST + new family/target split):

| Concept                    | Framework layer                              | Family layer (Mongo)                            | Target layer (Mongo)                                  |
|----------------------------|----------------------------------------------|-------------------------------------------------|-------------------------------------------------------|
| IR node base               | `interface SchemaNode { kind }`, `abstract class SchemaNodeBase` | `abstract class MongoSchemaNode extends SchemaNodeBase` (today's `MongoSchemaNode`, lifted to extend the framework base) | (target-specific concrete classes) |
| Storage / contract root    | `interface Storage { namespaces: Record<string, Namespace> }` | `abstract class MongoStorage implements Storage` | `class MongoTargetStorage extends MongoStorage`        |
| Collections                | —                                            | `abstract class MongoCollection extends MongoSchemaNode` | `class MongoTargetCollection extends MongoCollection` |
| Indexes / validators       | —                                            | `abstract class MongoIndex`, `abstract class MongoValidator` | `class MongoTargetIndex extends MongoIndex`, etc.    |
| Namespace                  | `interface Namespace`, `abstract class NamespaceBase` | (passes through) | `class MongoTargetDatabase extends NamespaceBase` (Namespace = the connection's `db`); `class MongoTargetUnspecifiedDatabase extends MongoTargetDatabase` (singleton default) |
| Verifier                   | `interface SchemaVerifier<TContract, TSchema>` | `abstract class MongoSchemaVerifierBase` + utility helpers | `class MongoTargetSchemaVerifier extends MongoSchemaVerifierBase`, exposed as `descriptor.schemaVerifier` |
| Serializer (round-trip)    | `interface ContractSerializer<TContract>` (`deserializeContract` + `serializeContract(): JsonObject`); reached via `descriptor.contractSerializer.<method>(…)` — no standalone `validateContract` function | `abstract class MongoContractSerializerBase` carrying Mongo-shared arktype validation + protected hooks | `class MongoTargetContractSerializer extends MongoContractSerializerBase`, exposed as `descriptor.contractSerializer` |
| SPI aggregation            | (none — no new aggregator interface)         | (none)                                          | The existing Mongo target descriptor grows two new named properties (`contractSerializer`, `schemaVerifier`) next to today's migration SPIs |
| Visitor (narrow ops)       | (none — visitor scope is domain-specific)    | `interface MongoSchemaVisitor<R>` (today's, lifted into the family-only role) | Optional target-extended visitor                       |

The two tables are deliberately parallel: a developer who reads the SQL Postgres column reads the Mongo column the same way. This is the cross-target consistency promise the architectural principles encode (see § "Codifying the convention" below).

# Requirements

## Functional Requirements

### IR architecture

- **FR1.** Both Contract IR and Schema IR are class hierarchies with a `kind` discriminator and frozen instances. Class fields are plain readonly properties; `JSON.stringify(node)` produces canonical JSON without a `toJSON()` method.
- **FR2.** Each IR is layered: framework interfaces + abstract bases, family abstract bases extending framework, target concrete classes extending family.
- **FR3.** Targets can introduce IR node kinds with no family-level counterpart (e.g. `PostgresFunction`, `PostgresEnum`, `PostgresSchema`). The framework requires only that target-only kinds extend framework `SchemaNode` (or a framework abstract base they choose to use).
- **FR4.** Targets that don't fit the family abstract scaffolding can implement the framework interface directly. The family abstract base is a convenience, not a gatekeeper.

### Domain operations

- **FR5.** Verification follows the 3-layer pattern: framework `SchemaVerifier<TContract, TSchema>` interface; per-SPI family abstract base (`SqlSchemaVerifierBase`, `MongoSchemaVerifierBase`) carrying SQL/Mongo-shared walk logic and exposing protected hooks; concrete target SPI implementer (`PostgresSchemaVerifier extends SqlSchemaVerifierBase`, `MongoTargetSchemaVerifier extends MongoSchemaVerifierBase`). The implementer instance is exposed as a named property on the **existing target descriptor** (`descriptor.schemaVerifier`), alongside today's `migrations` property. No new aggregator interface is introduced.
- **FR6.** The framework verifier walks the contract-space aggregate, dispatches to the right target's verifier (via `descriptor.schemaVerifier`) per space, and returns a unified `VerifyResult`. Target-specific issue kinds are widened target-side; the existing framework `SchemaIssue` type (in `framework-components/control/control-result-types.ts`) stays as-is for this project. The mis-layering of that type (SQL-flavoured vocabulary in a framework-level package) is documented as a forward concern in § "Forward note: `SchemaIssue` layering" but out of scope.
- **FR7.** Round-trip is performed via a framework-level SPI: `interface ContractSerializer<TContract> { deserializeContract(json: unknown): TContract; serializeContract(contract: TContract): JsonObject }`. The interface covers both directions; the symmetric framing locks in the JSON ⇄ classes seam at the SPI boundary and is the single named API surface the round-trip invariant, test infrastructure, and future canonicalization key off. Per-SPI family abstract bases (`SqlContractSerializerBase`, `MongoContractSerializerBase`) carry family-shared arktype validation and expose protected hooks for target-specific class construction. Concrete target SPI implementers (`PostgresContractSerializer`, `MongoTargetContractSerializer`) extend the family base; the existing target descriptor composes them as `descriptor.contractSerializer`.
- **FR8.** The standalone `validateContract` function is removed. Hydration call sites become `descriptor.contractSerializer.deserializeContract(json)` (and serialization, where needed, becomes `descriptor.contractSerializer.serializeContract(contract)`). Every existing `validateContract` call site is migrated. Framework-internal callers depend on the framework SPI interfaces (`ContractSerializer<TContract>`), never on a concrete target class or descriptor instance type. Tests that don't exercise serialization satisfy the SPI with a `createIdentityContractSerializer<TContract>()` helper the framework ships. The user-facing facade (`postgres<Contract>(...)`) wraps this primitive and hides the SPI from end-users.

### Authoring extensibility

- **FR8a.** `AuthoringContributions` gains an **`entityTypes`** namespace. Contributions in the namespace are descriptors of shape `{ kind: 'entity', discriminator: string, args?, output: { template } | { factory } }`, mirroring the existing `field` / `type` namespace shape (including the optional `args` argument-descriptor list that the existing template-output runtime consumes). The required `discriminator: string` field carries the kind tag the contributed IR-class instance will write into its on-disk JSON envelope (e.g. `'sql-enum-type'`); it is the load-bearing identifier the deserializer registry looks up at hydration time (FR8e). The `output` is either a declarative template (preferred where expressible — same `AuthoringTemplateValue` shape used by `field` / `type` outputs today, validated via the `args` descriptor list) or a factory function `(input, ctx) => SchemaNode` that constructs an IR-class instance from validated input — for factory output, input typing comes from the factory's parameter signature (`EntityHelperFunction<Descriptor>` extracts it via conditional inference), so the descriptor needs no parallel `schema` field. Adding an optional arktype-validated `schema` field for cross-runtime input validation is a forward-compatible addition admissible later without changing the descriptor's tagged-union shape. Both authoring runtimes (PSL and TS DSL) reach the same factory through the same descriptor — there is no parallel PSL-only contribution surface.
- **FR8b.** Pack-bag-driven type narrowing is symmetric with the existing `field` / `type` mechanism, with one structural difference: pack-contributed top-level entity helpers are placed at top level on the helpers object, alongside built-in top-level entities (`model`, `rel`). The `ComposedAuthoringHelpers<Family, Target, ExtensionPacks>` template flattens contributions from each pack's `entityTypes` namespace onto top level, merging via the existing `MergeExtensionXxx<Packs>` + `UnionToIntersection` template. **Top-level placement is the principle** (see Authoring surface § "Pack-contributed entity construction" above): a contract author calls `helpers.enum(...)` the same way they call `helpers.model(...)` — built-in and contributed top-level entities are grammatically indistinguishable from the user's vantage point. The contribution-data-structure name (`entityTypes`) and the user-surface placement (top-level helpers, no `entities.` namespace) reflect altitude-appropriate vocabulary, not a deliberate naming opposition; the composed-helpers template performs the contribution-data-structure → top-level-helper rename in the type system, no runtime cost. Type narrowing on `input` is full per the contributing pack's descriptor schema. (Refined in M9 R2b — the original M3.5 R1 / M7 surface placed contributed entities behind `helpers.entities.<name>`; M9 R2b flattened them to top level for built-in/contributed symmetry.)
- **FR8c.** The `composed-authoring-helpers.ts` scaffolding is lifted from its current SQL-only location ([`packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts`](../../packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts)) to a family-agnostic location so both SQL and Mongo contract-builders consume the same scaffolding. SQL-specific helper composition stays where it is and imports the lifted module; the Mongo contract-builder mirrors the SQL pattern via the lifted module.
- **FR8d.** Both family contract-builders (SQL: `packages/2-sql/2-authoring/contract-ts`; Mongo: `packages/2-mongo-family/2-authoring/contract-ts`) consume the new mechanism. Hand-edited family-layer construction sites that today directly instantiate target IR classes (the load-bearing gap diagnosed at M2 R2 close-out for Mongo, and the structurally identical gap on the SQL side) are replaced by entity contributions on the contributing pack.
- **FR8e.** **Family-layer deserializers dispatch through a contribution-driven registry; no per-kind hooks live on family bases.** When a family contract-serializer hydrates its `storage.types` (or any other IR slot admitting pack-contributed first-class entities), it dispatches on the entry's `kind` discriminator through a `ReadonlyMap<discriminator, EntityHydrationFactory>` registry built from the resolved authoring contributions in scope for the contract. The registry is constructed at descriptor-build time from the union of every pack's `entityTypes` contributions, keyed by each contribution's `discriminator` field (FR8a). The family base does not import per-kind IR classes; it does not declare per-kind `hydrateXxx` SPI hooks; it does not perform `if (kind === '<literal>')` branches on specific kinds. Adding a new pack-contributed entity type requires zero family-base changes — the contributing pack ships the descriptor + factory + discriminator and the registry routes through it. The same factory function used at authoring time is the hydration factory: input shape and JSON shape are the same for first-class entities, by construction. (Surfaced as a load-bearing architectural defect in PR1 review at architect SDR § 3.3 + principal-engineer F-pass; closed in M7.)

### Enums (refactor exemplar)

- **FR9.** Enum types are first-class IR nodes at the target layer. `class PostgresEnumType extends SqlNode` lives in `target-postgres`; the discriminator literal is `'postgres-enum'`. Per Decision 18, enum is a target-only concept (Postgres has native `CREATE TYPE … AS ENUM`; SQLite uses CHECK-constraint emulation; no other SQL target ships native enum support today). No family-layer `SqlEnumType` abstract — per the abstract-earns-existence rule, the abstract earns itself back if and when a second concrete subclass appears (today: zero). The slot type `SqlStorage.types: Readonly<Record<string, StorageType>>` is polymorphic at the framework level (`interface StorageType extends IRNode { readonly kind: string }`); `StorageTypeInstance` is the structural sub-interface for legacy codec-triple entries (which carry `kind: 'codec-instance'`). The enum factory at the contribution surface returns `PostgresEnumType` natively — no `as unknown as StorageTypeInstance` cast at the boundary.
- **FR10.** Enum verification dispatches via the new IR pattern, not via `codecHooks.verifyType` / `expandNativeType`. The codec-hook glue specific to enums is removed; codecs continue to own their generic verification responsibilities for non-enum types.
- **FR11.** Existing enum migrations (`CreateEnumTypeCall`, `AddEnumValuesCall`, `DropEnumTypeCall`) consume the IR nodes directly without an intermediate translation layer.
- **FR12.** The authoring DSL surface for enums is *semantically* preserved; users continue to declare enums and the resulting Contract IR carries equivalent enum-shaped data. Concretely: PSL `enum X { … }` syntax is unchanged; the TS authoring surface evolves from the legacy `type.enum(name, values)` shape to the canonical `enum({ name, values })` shape — the intentional outcome of the M3.5 entities-mechanism (every contributed top-level entity takes top-level `helpers.<name>(input)` shape post-M9 R2b; preserving a parallel `type.enum` shim would be the backward-compat pattern this project rejects per `.cursor/rules/no-backward-compatibility.md`). Internal lowering routes through the new IR for both surfaces. (Adjudicated at `wip/unattended-decisions.md § 19`.)

### Namespace (new concept)

- **FR13.** `Namespace` is a framework-level interface with a convenience abstract base; both extend the framework IR-node alphabet (`interface Namespace extends IRNode`, `abstract class NamespaceBase extends IRNodeBase implements Namespace`). The framework `Storage` interface (`interface Storage extends IRNode`) carries `readonly namespaces: Record<string, Namespace>` so the FR15 invariant ("every storage object belongs to a namespace") is enforced at the type level for every family — and the framework's own IR-node alphabet describes Storage as a typed IR node, not an unprefixed structural promise. Postgres ships `PostgresSchema extends NamespaceBase` (the named-schema concretion) plus `PostgresUnboundSchema extends PostgresSchema` (the late-bound singleton, see FR14); SQLite ships its singleton concretion; Mongo ships `MongoTargetDatabase extends NamespaceBase` mapping to the connection's `db` field plus its own connection-bound singleton subclass. **PR1 lands the SQL-side stub:** `class SqlStorage extends SqlNode implements Storage` with `readonly namespaces` defaulted to `{ [UNBOUND_NAMESPACE_ID]: SqlUnboundNamespace.instance }` (a family-layer placeholder); PR2's M5a swaps the placeholder for the per-target concretions. Both families honour the framework `Storage` interface from PR1 forward.

- **FR14.** A reserved sentinel IR namespace id `__unbound__` represents the late-bound slot — the slot whose physical schema is resolved at connection time via target-specific mechanisms (Postgres `search_path`; per-target equivalents elsewhere). Exported as the framework constant `UNBOUND_NAMESPACE_ID` from `@prisma-next/framework-components/ir` so call sites do not depend on the literal string. The sentinel is realised per-target as a **singleton subclass** of that target's Namespace concretion (e.g. `class PostgresUnboundSchema extends PostgresSchema` with `readonly id = UNBOUND_NAMESPACE_ID`, exposed via a stable static reference `PostgresSchema.unbound`). The subclass overrides the namespace's serialization methods to elide the namespace qualifier in emitted DDL; call sites stay polymorphic (no `if (namespace.id === UNBOUND_NAMESPACE_ID)` branches anywhere). The double-underscore decoration is deliberate: `__unbound__` reads cold as a reserved framework sentinel in JSON envelopes and carries no realistic collision risk with user-declared namespaces. Defensive validation rejects user-declared namespaces named `__unbound__` at the TS DSL surface.

  **PSL `unbound` keyword vs IR `__unbound__` slot are two distinct concepts at two layers.** PSL `unbound` is a user-facing keyword that — in targets with late-binding semantics — lowers to the IR `__unbound__` slot. The PSL parser does not reserve `unbound`; reservation is per-target interpreter (see FR16d). The two spellings differ deliberately: PSL is human-facing (clean keyword, no decoration); IR is machine-facing (sentinel-decorated, reserved).

- **FR15.** Every storage object in Contract IR and Schema IR belongs to a namespace. **Storage shape is a nested map keyed by namespace id**: `tables: Record<NamespaceId, Record<TableName, StorageTable>>` (and analogously for types, functions, and other storage object slots that targets define). The JSON envelope mirrors this shape directly. This honestly reflects the database reality — table names are unique within a namespace, not across them — and avoids the synthetic qualified-key encoding that flat maps would require. The verifier walks the nested map and matches contract objects to schema objects via `(namespace.id, name)` rather than `name` alone.

- **FR16.** Existing single-namespace contracts migrate to the new shape with no PSL rewrite required. The mapping is per-target (see FR16d) and **single-tenant Postgres behaviour is preserved**: top-level models (no `namespace { … }` block) lower through the Postgres interpreter to the IR `public` slot — the concrete `public` schema, qualified DDL. SQLite top-level models lower to the singleton slot (no qualifier). Mongo top-level models lower to the connection-`db` slot. Late binding (Postgres only today) is an explicit opt-in via PSL `namespace unbound { … }` blocks — never a default. Users who want late-bound multi-tenancy positively declare it.

- **FR16a.** The authoring DSL exposes namespace declarations in both PSL and the TS builder, with surfaces kept structurally parallel so moving between them is mechanical for users.

  **PSL AST shape.** `PslDocumentAst.namespaces: readonly PslNamespace[]` is the **only models container**. There is no top-level `models[]` / `enums[]` / `compositeTypes[]` slot on `PslDocumentAst` — these collapse into the nested-by-namespace shape. The framework parser collects top-level elements declared outside any `namespace { … }` block into a synthesised entry `PslNamespace { name: UNSPECIFIED_PSL_NAMESPACE_ID, models: [...], enums: [...], … }` where `UNSPECIFIED_PSL_NAMESPACE_ID = '__unspecified__'` is the framework parser's name for the syntactic-absence bucket. This entry is internally-synthesised — the user never writes `namespace __unspecified__ { … }`; the double-underscore decoration is the framework's signal that this is a parser-synthesised identifier.

  **PSL surface.** A top-level `namespace <name> { … }` block can contain model, enum, composite type, and `types` block declarations. Namespace blocks live only at the top level — they cannot recursively contain other namespace blocks (a `namespace a { namespace b { … } }` form is a parse error; this mirrors the flat-schema reality of every supported database). Blocks are **reopenable**: multiple `namespace foo { … }` blocks in the same file (or across files in a multi-file contract) merge into one AST entry. The framework parser is purely syntactic and reserves no identifiers — `unbound`, `public`, `auth` are all just strings. Bare-name resolution within a namespace: local namespace first, then `__unspecified__` (the syntactic-absence bucket), then error.

  **TS builder surface.** `defineContract`'s top-level config gains a `namespaces` declaration list (e.g. `namespaces: ['public', 'auth']`) naming the namespaces this contract owns. The `model(name, config)` factory accepts a per-model `namespace` field (e.g. `model('User', { namespace: 'auth', fields: {…} })`) naming one of the declared namespaces, defaulting to the implicit `__unspecified__` AST bucket when omitted. The model-handle return value (with `.refs.<field>` accessors) carries the namespace coordinate so cross-namespace FK references downstream require no new syntax (see FR16b).

- **FR16b.** Cross-namespace FK references within a single contract space are first-class. The FK reference IR carries a namespace coordinate on both sides; the verifier dispatches on `(namespace.id, name)` for both ends.

  **PSL authoring surface — dot-qualified field type position.** Cross-namespace references qualify in the **type position** of the field, not in the `references:` list: `user auth.User @relation(fields: [userId], references: [id])`. The `references:` list continues to take plain column names — the namespace+model is implicit from the field type. Discovery from probing the framework parser: `PslField.typeName` already stores a `string` (dot-joined when parsed via the existing type-constructor path); the framework parser's bare-type fallback regex needs one extension (`^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$`) to accept dotted identifiers in fields without parens. The printer round-trips `typeName` verbatim, so no printer-level changes are needed for the relation syntax.

  **TS builder authoring surface.** No new syntax. The model handle returned by `model(name, config)` carries its namespace coordinate, so existing FK call sites — `constraints.foreignKey(cols.userId, User.refs.id, { name: … })` in the SQL-block constraints DSL, and `rel.belongsTo(User, { from: 'userId', to: 'id' })` in the relations DSL — automatically lower to cross-namespace IR when `User`'s namespace differs from the referencing model's. The namespace coordinate is inferred from the target model handle, never declared per-reference.

  **DDL emission rule (Postgres).** Named-schema namespaces emit qualified DDL — `ALTER TABLE "public"."profiles" ADD CONSTRAINT … FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id")`. The IR `__unbound__` slot emits unqualified DDL — `REFERENCES "users"("id")` — and lets Postgres's `search_path` resolve the schema at migration time. This is symmetric with `__unbound__` table-creation DDL (`CREATE TABLE "users"` rather than `CREATE TABLE "<schema>"."users"`) and supports per-tenant multi-tenancy migration runs without contract-level changes — each tenant migration anchors its own FK by OID at creation time via Postgres's standard storage. The operational hazard — `search_path` misconfiguration in multi-tenant deployments can cause silent data loss — is documented in the namespace ADR; the IR does not try to prevent it.

  **FK reference IR structure.** The FK IR is restructured to surface source-vs-target cleanly: `ForeignKey { source: ForeignKeySource, target: ForeignKeyTarget, … }` where `ForeignKeySource = { columns: string[] }` and `ForeignKeyTarget = { namespaceId: string, table: string, columns: string[] }`. FK-level metadata (`constraint`, `index`, `name`, `onDelete`, `onUpdate`) stays at the `ForeignKey` level. The pre-existing `ForeignKeyReferences` (plural) type is renamed to `ForeignKeyReference` (singular) since each FK has exactly one reference target; the corresponding `ForeignKey.references` field is renamed `ForeignKey.reference`. These rename-and-restructure changes land in PR2's M5b alongside the cross-namespace IR work.

  Cross-*contract-space* FK references remain out of scope per Non-goals. The `(namespace.id, name)` reference shape introduced here is deliberately structured to admit a leading `spaceId` coordinate when cross-contract refs land — extending the reference to `(spaceId, namespace.id, name)` is an additive change to the FK reference IR + planner DDL + verifier dispatch, with no rework of this project's deliverables. Implementers should keep this extension point in mind: don't fuse `namespace.id` and `name` into a single composite key, and don't bake "single contract space" assumptions into the FK reference walk.

- **FR16c.** PSL → Contract IR lowering is **per-target** (each family's existing PSL interpreter package owns its target's semantics: `packages/2-sql/2-authoring/contract-psl/` for SQL, `packages/2-mongo-family/2-authoring/contract-psl/` for Mongo). The framework parser is purely syntactic. Each target's interpreter maps AST namespaces to IR storage slots per its semantics:

  | AST entry | Postgres interpreter | SQLite interpreter | Mongo interpreter |
  |---|---|---|---|
  | `__unspecified__` (implicit, top-level) | IR `public` slot (concrete `PostgresSchema`) | IR `__unbound__` slot (singleton `SqliteUnboundDatabase` — trivial binding) | IR `__unbound__` slot (singleton `MongoTargetUnboundDatabase` — connection's `db`) |
  | `unbound` (explicit `namespace unbound { … }`) | IR `__unbound__` slot (`PostgresUnboundSchema`; `search_path` resolution) | **reject** — diagnostic: "SQLite does not support namespace blocks" | **reject** — same diagnostic, Mongo-flavoured |
  | named (`auth`, `public`, `foo`, …) | IR named schemas | **reject** (same diagnostic) | **reject** (same diagnostic; Mongo's multi-database support is a future-work concern) |

  The framework constant `UNBOUND_NAMESPACE_ID` names "the slot whose binding the target resolves at connection time" — Postgres uses it for `search_path`-resolved late binding (a non-trivial multi-tenancy concern); SQLite uses it for the trivial singleton (the only schema); Mongo uses it for the connection-`db` binding. Same slot id across all targets; per-target resolution semantics.

  **Same AST, different IR per target.** Reading D: the PSL AST is target-agnostic syntax; semantic meaning is assigned by the per-target interpreter. The same `namespace unbound { … }` source compiles to IR `__unbound__` in Postgres and to a diagnostic in SQLite — because `unbound` is a Postgres-flavoured keyword. SQLite and Mongo reject all explicit `namespace { … }` blocks today; future work can lift this per-target if either gains a use case (Mongo multi-database is plausible; SQLite probably never).

  **Reserved-name validation is per-target.** Postgres reserves `unbound` in its interpreter (rejects user-declared namespaces named `unbound` since the identifier is consumed for late-binding). SQLite and Mongo do not reserve `unbound` separately — they reject all explicit namespace blocks anyway.

  **Reopen-merge across explicit + implicit slots.** A contract that declares both top-level (implicit `__unspecified__`) models and explicit `namespace public { … }` blocks merges both into the same IR `public` slot in Postgres (namespaces are open for extension; same in PSL and IR). Key collisions within the merged slot (same table name in both sources) remain errors.

- **FR16d.** The PR2 mechanical-rename task lands first in M5a (load-bearing prerequisite for the design work that follows). Touchpoints: framework constant `UNSPECIFIED_NAMESPACE_ID` → `UNBOUND_NAMESPACE_ID`; literal `'__unspecified__'` → `'__unbound__'` at every IR call site and JSON envelope key; class `SqlUnspecifiedNamespace` → `SqlUnboundNamespace`; class `MongoTargetUnspecifiedDatabase` → `MongoTargetUnboundDatabase`; ADR drafts under `projects/target-extensible-ir/specs/` (`3-layer-polymorphic-ir-convention.md`, `architectural-principles.md`); existing test fixtures that hardcode the literal. The rename is mechanical and lands as a focused commit before the design work goes on top. The PSL AST identifier `__unspecified__` (the framework parser's name for the syntactic-absence bucket) is **not** renamed — the two layers carry different concepts and the spellings reflect that.

### Mongo migration

- **FR17.** Mongo's existing `MongoSchemaNode` / `MongoSchemaVisitor` Schema IR is restructured into the 3-layer split (framework / family-mongo / target-mongo), with target-mongo concrete classes extending family-mongo abstract bases.
- **FR18.** Mongo's Contract IR is fully unified under the AST-class pattern, layered family / target. This includes the currently-disjoint `MongoIndex` / `MongoIndexOptions` / `MongoCollationOptions` types and any other nested data shapes — no half-flat / half-AST state inside the Mongo family.

### Visitors

- **FR19.** Visitor interfaces remain available for narrow structural operations (pretty-print, diagnostics). They are declared at the layer that owns the kind alphabet (family for family-known kinds; target for target-extended visitors).
- **FR20.** Existing consumers that use a visitor (e.g. CLI display, diagnostic rendering) continue to work without changes to their consumption pattern, modulo the visitor's location in the new layering.

### Documentation

- **FR21.** `AGENTS.md` / `CLAUDE.md` Golden Rule on "Interface-Based Design" is split into the service-vs-AST/IR distinction described in § "Codifying the convention".
- **FR22.** `docs/reference/typescript-patterns.md` gains a sibling section to "Interface-Based Design with Factory Functions" that documents the AST/IR class-hierarchy pattern with public class exports, referencing the same canonical examples as this spec's reference-implementations table.
- **FR23.** `docs/Architecture Overview.md` § "Guiding Principles" surfaces the two architectural principles "framework provides affordances; targets implement specifics" and "familiar with one target, fluent in another" — either as new principles or as enrichment of "Thin core, fat targets".
- **FR24.** Subsystem docs that reference today's flat-data Contract IR / Schema IR are updated to reflect the new class-hierarchy shape (`docs/architecture docs/subsystems/` — at minimum: Data Contract, Contract Emitter & Types, Adapters & Targets).
- **FR25.** ADRs codifying the 3-layer convention and the underwriting principles are *drafted* during execution and *promoted* to `docs/architecture docs/adrs/` at project close-out (timing per the project workflow rule).

## Non-Functional Requirements

- **NFR1.** The on-disk JSON shape changes only to accommodate the new IR (notably namespace; minor field additions for kind discriminants where they're not already implicit). Breaking changes to existing contracts are acceptable (pure 0.x mindset); existing fixtures and examples are migrated big-bang alongside the IR shape change in the same PR — no dual-shape transition window. Mongo fixtures migrate in M2 alongside the Mongo IR flip; SQL fixtures migrate in M3 alongside the Postgres SPI shells PR.
- **NFR2.** Round-trip fidelity: for any target, `descriptor.contractSerializer.deserializeContract(JSON.parse(JSON.stringify(descriptor.contractSerializer.serializeContract(contract))))` produces a contract structurally equivalent to the original. Tested for Postgres, SQLite, and Mongo.
- **NFR3.** No regression in the existing verifier's behaviour for cases the new IR can express. Tests for verification (existing `verifySqlSchema` test suite) pass after migration to the new architecture.
- **NFR4.** No silent loss of information. Anything previously stored in `annotations: SqlAnnotations` that becomes a first-class IR concept (currently: nothing planned beyond namespace; future: RLS) keeps working through the migration; anything that stays in `annotations` keeps round-tripping.
- **NFR5.** The pattern is documented as a project-wide convention — every domain interface that crosses the framework/target boundary follows the recipe (interface in framework, optional abstract base in family, concrete in target, target-can-skip-family escape valve). The convention is captured as an ADR at project close-out.
- **NFR6.** Layering is enforced by `pnpm lint:deps` after the refactor: framework does not import from family; family does not import from target; target imports family and framework as needed.
- **NFR7.** Hydration validates JSON structure via arktype schemas at the layer that owns each kind (framework schemas for framework kinds; family schemas for family kinds; target schemas for target-only kinds). Validation composes layer-by-layer.

## Non-goals

- **Cross-contract-space FK references** (`refIn(otherSpace, …)`). The IR refactor unblocks this work but the cross-space reference semantics, authoring DSL, and resolution rules are deferred to a separate project. The FK reference IR introduced here (`(namespace.id, name)`) is designed to extend additively to `(spaceId, namespace.id, name)` when that follow-up lands — see FR16b for the extension-point contract this project commits to.
- **RLS policies as first-class IR.** The Postgres-side `RlsPolicy` node, authoring DSL, migration ops, and runtime session-state injection are deferred to the Supabase project (or a dedicated RLS project).
- **Supabase deliverables.** The `createSupabaseRuntime` factory, `auth.users` queryable surface, Supabase contract package, quickstart scaffold are all deferred. This project ships the IR foundation they need; nothing more.
- **Richer authoring-DSL ergonomics for namespaces beyond the basic surface.** The basic authoring surface (PSL: top-level `namespace { … }` blocks; TS: top-level `namespaces` declaration list + per-model `namespace` field; both with cross-namespace FK refs via existing `@relation` / model-handle mechanisms) is in scope per FR16a / FR16b / AC4 / AC4a. Richer ergonomics — recursive namespace nesting, namespace-as-module imports, qualified-name shorthand for in-namespace types, namespace re-exports, ergonomic shortcuts — are out of scope.
- **Target-contributed top-level PSL blocks.** The framework PSL parser remains hardcoded for the small set of top-level keywords it knows (`model`, `enum`, `type`, `types`, plus the new `namespace` block this project adds). Target packs cannot contribute genuinely target-specific top-level PSL keywords (e.g. `policy { … }` for RLS, `role { … }` for Postgres roles) — they extend the *semantic lowering* of framework-parsed keywords via the M3.5 entity-contribution mechanism, but not the *parser* itself. This is a substrate gap that downstream work (RLS, roles, custom types) will hit. **Follow-up project (post-this-project):** target-contributed top-level PSL block registry; migrate `enum` from framework-parser to Postgres-pack contribution as the proof-of-concept. The `namespace { … }` block stays framework-parsed because it's a framework concept that every multi-storage target needs; per-target *semantic interpretation* of the AST is handled today by per-family interpreters (see FR16c).
- **Planner-side detection of intended namespace rebinds.** When a contract changes a model's namespace declaration (e.g. moves a model from top-level into `namespace public { … }`, or from `namespace unbound { … }` to `namespace public { … }`), the planner cannot distinguish a deliberate rebind (same physical table, new contract slot) from a delete-and-recreate (different physical table). Today the planner emits drop+create on any slot mismatch. The future `@hint(was: 'oldSlot')` mechanism (referenced in ADR 001) is the durable solution for declaring rebind intent — it solves the same problem for table renames and for namespace rebinds with one syntax. Until `@hint` lands, users wanting a rebind without data loss handle it manually via raw SQL escape hatches. PR2 ships no informational diagnostic for slot transitions because every slot mismatch looks identical to the planner; the diagnostic would either fire spuriously on every legitimate move or require the same impossible inference it's trying to flag.
- **Migration of `databaseDependencies.init`-installed schemas** to first-class IR. That work belongs to the contract-spaces project, not this one.
- **Schema IR persistence on disk.** Schema IR is an in-memory artifact and stays that way. We have no current or anticipated use for persisting Schema IR. The `ContractSerializer` SPI's symmetric framing applies to Contract IR only; Schema IR's class-hierarchy shape is reached exclusively through introspection.

## Sequencing constraints

This project must land **after** the Contract Spaces follow-up work because both projects contend for the same files. Strict-precedence dependencies (in order):

1. **[TML-2457 — APP_SPACE_ID coupling audit](https://linear.app/prisma-company/issue/TML-2457).** Audits 294 sites across 75 files and reroutes structural references through `aggregate.app.spaceId`. Conflicts with this project's FR8/AC12 migration on the same test files.
2. **[TML-2463 — SQLite multi-space planner upgrade](https://linear.app/prisma-company/issue/TML-2463).** Conflicts on SQLite planner files this project reshapes. Independent of TML-2408 — can run in parallel.
3. **[TML-2408 — Port contract spaces to Mongo family](https://linear.app/prisma-company/issue/TML-2408).** Direct collision with this project's Mongo migration (M2). Independent of TML-2463 — can run in parallel. Sequencing constraint to flag in TML-2408's plan: Mongo must land fully aggregate-native in TML-2408, not in a half-migrated transition window, otherwise this project's Mongo step deals with mixed-state Mongo code.

Independent / non-blocking: [TML-2458](https://linear.app/prisma-company/issue/TML-2458) (cheap; can land any time) and [TML-2464](https://linear.app/prisma-company/issue/TML-2464) (must land **after** this project so branch-removal touches IR-walking sites once, post-IR-flip, rather than twice).

# Acceptance Criteria

- [ ] **AC1.** Existing Postgres, SQLite, and Mongo test suites (unit + integration + e2e) pass after the IR refactor. Specifically: `verifySqlSchema` tests, planner tests, Mongo Schema IR tests, contract round-trip tests, integration tests against PGlite and `mongodb-memory-server`.
- [ ] **AC2.** Enum types are first-class IR nodes — at every layer that touches the enum slot. Concretely (per M9 architectural-honesty close): (a) `SqlStorage.types` slot type accepts polymorphic IR (typed as `Readonly<Record<string, StorageType>>`, where `StorageType` is the framework abstract; `StorageTypeInstance` is the structural sub-interface for legacy codec-triple entries which carry `kind: 'codec-instance'`); (b) the enum factory at the contribution surface returns the IR class natively — no `as unknown as StorageTypeInstance` cast; (c) the IR class lives at the target layer only — `class PostgresEnumType extends SqlNode` (no unearned `SqlEnumType` family abstract; per Decision 18, enum is target-only); (d) the discriminator literal `'postgres-enum'` reflects the target altitude (not the family altitude). After the enum exemplar lands, the codec-hook path for enum verification (`codecHooks.verifyType` / `expandNativeType` calls in `verify-sql-schema.ts` for the enum case) is removed; verification, planning, and contract round-trip of enums all flow through the new IR. Existing enum tests pass without semantic change. (Application-facing enum DX — typed declaration, value defaults, query input/output, runtime introspection — is out of scope here; routed to the [`postgres-enum-finishing` project](../postgres-enum-finishing/spec.md).)
- [ ] **AC3.** A target adds an IR node kind with no family-level counterpart (e.g. a stub `PostgresExtension` test fixture) without modifying framework or family code. The target's `ContractSerializer` implementation handles the kind in both round-trip directions (`deserializeContract` and `serializeContract`); the target's verifier handles it during verification; framework consumers (display, hashing) round-trip it through JSON.
- [ ] **AC4.** A Postgres contract declares two namespaces (`public` and `auth`) with tables in each. Tables in each namespace are emitted with the correct namespace qualifier (`CREATE TABLE "auth"."users" (...)`). Cross-namespace FKs from `public.profiles.user_id` to `auth.users(id)` (within the same contract space) are emitted as `ALTER TABLE "public"."profiles" ADD CONSTRAINT ... FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id")` and verification against a live database with both schemas + the FK passes.
- [ ] **AC4a.** The authoring DSL exposes namespace declaration in both PSL and the TS builder.

  **TS builder:** `defineContract`'s config declares a `namespaces` list; each `model(...)` call carries a `namespace` field naming one of the declared namespaces (defaulting to the implicit `__unspecified__` AST bucket when omitted, which the Postgres interpreter lowers to the IR `public` slot — preserving single-tenant Postgres behaviour). Cross-namespace FK references require no new syntax — the model handle carries the namespace coordinate, so existing `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` (SQL-block constraints) and `rel.belongsTo(OtherModel, …)` (relations DSL) call sites lower to cross-namespace IR automatically.

  **PSL:** a contract declares its namespaces via top-level `namespace <name> { … }` blocks (reopenable; multiple blocks for the same name merge; namespace blocks do not recursively contain other namespace blocks); top-level elements declared outside any namespace block are collected by the framework parser into the implicit `__unspecified__` AST entry (backward compat). The Postgres interpreter lowers the implicit `__unspecified__` to the IR `public` slot (no behavioural change for single-tenant users); SQLite and Mongo lower it to their singleton / connection-bound slot. Cross-namespace FK references use dot-qualified type references in `@relation` (`auth.User @relation(fields: [userId], references: [id])`).

  A round-trip authoring → contract.json → re-hydrated Contract IR preserves the declared namespaces and per-model assignments for both authoring surfaces.
- [ ] **AC5.** A SQLite contract uses the singleton namespace slot; the SQL emitter elides namespace qualifiers; the verifier matches contract to schema correctly. Any explicit `namespace { … }` PSL block (named or `unbound`) is rejected by the SQLite interpreter with a clear "SQLite does not support namespace blocks" diagnostic.
- [ ] **AC6.** A multi-tenancy Postgres contract opts into late binding by declaring `namespace unbound { … }` blocks (which lower to the IR `__unbound__` slot); the connection's `search_path` resolves the namespace at runtime. Demonstrated end-to-end via a multi-tenancy integration test. Single-tenant Postgres contracts (top-level models, no `namespace { … }` block) continue to lower to the IR `public` slot and emit qualified DDL — verified separately via the existing single-namespace test suite.
- [ ] **AC6a.** The Postgres PSL interpreter rejects user-declared namespaces named `unbound` (the identifier is reserved for the late-binding sentinel mapping). SQLite and Mongo interpreters reject all explicit `namespace { … }` blocks today; the rejection diagnostic names the target and points at the offending block span.
- [ ] **AC6b.** The framework PSL parser produces `PslDocumentAst.namespaces: readonly PslNamespace[]` as the only models container. Top-level declarations are collected into an implicit `PslNamespace { name: '__unspecified__', … }` entry. Verified by a parser test that asserts the AST shape for (1) a fully top-level schema (single implicit entry), (2) a fully blocked schema (no implicit entry), and (3) a mixed schema (implicit entry plus named entries). No top-level `models[]` / `enums[]` slot survives on `PslDocumentAst`.
- [ ] **AC7.** Mongo's Contract IR and Schema IR are migrated to the 3-layer split; existing Mongo tests pass; the family/target boundary is observable in code (family-mongo abstract bases consumed by target-mongo concrete classes).
- [ ] **AC8.** Round-trip fidelity: for any target, `descriptor.contractSerializer.deserializeContract(JSON.parse(JSON.stringify(descriptor.contractSerializer.serializeContract(contract))))` yields a structurally equivalent class hierarchy. `JSON.stringify` over the class instance also produces the same canonical JSON shape as `serializeContract`. Verified via property tests.
- [ ] **AC9.** `AGENTS.md` / `CLAUDE.md` rule is updated; `docs/reference/typescript-patterns.md` gains the AST/IR class-hierarchy section; `docs/Architecture Overview.md` surfaces the two architectural principles. Reviewable as docs diffs in the project's PRs.
- [ ] **AC10.** ADR drafts capturing (a) the 3-layer polymorphic IR convention and (b) the architectural principles underwriting it exist under `projects/target-extensible-ir/specs/` (to be promoted to `docs/architecture docs/adrs/` at project close-out).
- [ ] **AC11.** `pnpm lint:deps` passes; no new layering violations are introduced. Layering rules are tightened where the new structure permits.
- [ ] **AC12.** Every `validateContract` call site is migrated to `descriptor.contractSerializer.deserializeContract(json)` (or, for tests, the same call against `createIdentityContractSerializer<TContract>()`). The standalone `validateContract` function is removed from the codebase; the user-facing facade (`postgres<Contract>(...)`) wraps the SPI call so end-users do not see it directly. Framework-internal call sites depend on the framework SPI interface (`ContractSerializer<TContract>`), never on a concrete target descriptor type — verified by inspection of the migrated call sites and the absence of `validateContract` from the public exports.
- [x] **AC12a (mechanism-level subclauses, M3.5 R1; refined in M7 + M9 R2b).** The `AuthoringContributions.entityTypes` namespace exists; both family contract-builders (SQL + Mongo) consume the lifted family-agnostic scaffolding in [`@prisma-next/contract-authoring`](../../packages/1-framework/2-authoring/contract/src/composed-helpers-scaffolding.ts); pack-bag-driven type narrowing surfaces contributed entity helpers at top level — `helpers.<entityName>` alongside built-in `helpers.model` / `helpers.rel` (the contribution-side namespace `entityTypes` is renamed to top-level helpers in the composed-helpers template; no runtime cost) — with input typing inferred from the descriptor's factory signature. The family-layer deserializer dispatches through a contribution-driven registry keyed by each descriptor's `discriminator` field (FR8e); no per-kind hooks live on family bases. An in-tree synthetic pack exemplar at [`packages/2-sql/2-authoring/contract-ts/test/entities-namespace.exemplar.test.ts`](../../packages/2-sql/2-authoring/contract-ts/test/entities-namespace.exemplar.test.ts) verifies the type-narrowing, runtime construction, JSON-cleanliness, and registry-driven hydration paths.
- [ ] **AC12a (named-exemplar subclauses, deferred to M4 + M5a).** The two structural exemplars contribute via the new namespace: M4's enum entity is contributed by the Postgres pack as `helpers.enum(...)`; M5a's namespace entity is contributed by each native-namespacing target pack (Postgres, Mongo) as `helpers.namespace(...)`. Removing either contribution from its pack causes the corresponding exemplar's tests to fail with the expected "no entity helper named …" type error — verifying the contribution path is load-bearing, not duplicated by a hand-edited family-layer fallback. These subclauses land naturally with their respective milestones since M4 + M5a are the named structural exemplars; until then, the synthetic exemplar above proves the mechanism end-to-end.
- [ ] **AC13.** Mongo family→target dependency direction matches SQL (target depends on family; never the reverse). `@prisma-next/family-mongo` does not depend on `@prisma-next/target-mongo`, `@prisma-next/adapter-mongo`, or `@prisma-next/driver-mongo` (verify with `cat packages/2-mongo-family/9-family/package.json | rg "target-mongo|adapter-mongo|driver-mongo"` returning zero hits in `dependencies`). The Mongo control descriptor (`mongoTargetDescriptor`) lives in `@prisma-next/target-mongo` (mirroring SQLite's `packages/3-targets/3-targets/sqlite/src/core/control-target.ts`); the family's public API (`@prisma-next/family-mongo/control`) re-exports it for backwards-compat with consumers but does not own the implementation. The three Mongo family SPI bases (`MongoContractSerializerBase`, `MongoSchemaVerifierBase`, abstract `MongoStorageBase`) live at the family layer (`@prisma-next/family-mongo`), matching where SQL's SPI bases land — not at the foundation layer (`@prisma-next/mongo-contract`) where M2 R1 originally placed them as a workaround for the inverted dep edge. Detailed task spec at `projects/target-extensible-ir/specs/relocate-mongo-target-descriptor.spec.md`.

# Other Considerations

## Security

This project is an internal architecture refactor; no new user data flows or external surfaces are introduced. The existing security properties of today's `validateContract` (arktype validation of JSON shape before construction) are preserved by the SPI's `deserializeContract` method; the family abstract base owns family-shared arktype validation, the target subclass owns target-specific structural checks, and validation composes layer-by-layer. Class instances cannot be constructed except via the SPI's `deserializeContract` or authoring DSL → both validated paths.

## Cost

No infrastructure cost. Internal engineering effort is the only cost — a sizeable refactor across the framework, sql-family, mongo-family, and three targets (postgres, sqlite, mongo). Cost ledger to be sized by the principal-engineer pass.

The largest single touchpoint is the `validateContract` removal (FR8): every existing call site migrates to `descriptor.contractSerializer.deserializeContract(json)`. Framework-internal callers are mechanical. Tests dominate the labour — most tests construct a contract literal and call `validateContract`, so each test acquires either a real target descriptor import or the framework-provided `createIdentityContractSerializer<TContract>()` helper. The plan sequences this work so the test-migration cost shakes out against a stable IR shape: M1 establishes the SPI interfaces and the identity helper, M2 commits Mongo to them, M3 lands the `validateContract` → SPI migration alongside the Postgres + SQLite IR class flip — rather than compounding the test migration with the structural changes in a single pass. Postgres and SQLite share family-level abstract bases (`SqlTable`, `SqlColumn`, `SqlForeignKey`, …), so flipping one to the new class shape without the other would leave the family abstract bases in a dual-shape state — incompatible with NFR1 ("no dual-shape transition window"). M3 therefore lands as a single PR covering both targets.

## Observability

The verifier's existing diagnostic surface (`SchemaIssue.kind`, `VerifyDatabaseSchemaResult`) remains; target-specific issue kinds are now first-class (currently: nothing new beyond namespace mismatch; future: RLS-policy-mismatch, function-shape-mismatch, etc.). CLI display of verification results is unchanged for users; the diagnostics may be richer when targets emit target-specific issue kinds.

## Data Protection

No personal data flows are touched. Contract content is metadata describing schema structure, not user data.

## Analytics

Not applicable.

# References

- [ADR 195 — Planner IR with two renderers](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md). The `OpFactoryCall` precedent — frozen-class IR with target-owned union, JSON-clean fields, kind discriminant, target abstract base, target concrete classes. The recipe this project applies to Contract IR and Schema IR.
- [ADR 192 — ops.json is the migration contract](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md). The JSON-canonical / class-in-memory round-trip pattern proven for migration ops; this project extends it to Contract IR and Schema IR.
- [ADR 196 — In-process emit for class-flow targets](../../docs/architecture%20docs/adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md). The hydration-by-class-flow pattern; informs how the target's `ContractSerializer` resolves and constructs class instances.
- [ADR 187 — MongoDB schema representation for migration diffing](../../docs/architecture%20docs/adrs/ADR%20187%20-%20MongoDB%20schema%20representation%20for%20migration%20diffing.md). The existing AST-class pattern for `MongoSchemaIR`; this project promotes it to the framework layer.
- [ADR 188 — MongoDB migration operation model](../../docs/architecture%20docs/adrs/ADR%20188%20-%20MongoDB%20migration%20operation%20model.md). Sibling pattern at the migration-op layer for Mongo.
- `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` — concrete reference implementation of the `OpFactoryCall` pattern; the structural template for target IR class hierarchies.
- `packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts` — concrete reference implementation of the AST-class pattern for Schema IR.
- [ADR 185 — SPI types live at the lowest consuming layer](../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — the dependency-inversion / SPI pattern this project's domain interfaces follow (verifier, hydrator, etc.).
- [`docs/Architecture Overview.md`](../../docs/Architecture%20Overview.md) § "Guiding Principles" — gets updated as part of this project (FR23) to surface the architectural principles underwriting the convention.
- [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" — gets a sibling section as part of this project (FR22) to document the AST/IR class-hierarchy pattern.
- [`AGENTS.md`](../../AGENTS.md) / [`CLAUDE.md`](../../CLAUDE.md) line 93 — gets updated as part of this project (FR21) to split the "Interface-Based Design" rule along the service-vs-AST/IR axis.
- [`projects/extension-contract-spaces/spec.md`](../extension-contract-spaces/spec.md) — sibling in-flight project; this project's IR refactor is a natural complement (contract-space-aware contract.json layering benefits from a target-extensible IR but does not depend on it).
