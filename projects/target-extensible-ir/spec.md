# Summary

Prisma Next's Contract IR and Schema IR are flat data shapes (`type = { ... }`) consumed by framework code that imports their concrete types directly. There is no honest seam through which a target can introduce IR concepts that don't exist in other targets — Postgres schemas, MySQL databases, future RLS policies, target-specific functions and enums all have to wedge themselves in through opaque `annotations.pg` payloads or be left out of the IR entirely. This project flips both Contract IR and Schema IR to a polymorphic class hierarchy modelled on the existing migration-op IR (ADR 195) and Mongo Schema IR, layered as **framework interfaces → family abstract bases → target concrete classes**, with domain operations (verification, hydration, planning) following the same layering pattern. As the canonical demonstration that the new architecture works, **Namespace** is introduced as a first-class framework concept with target concretions (Postgres `schema`) and a `__unspecified__` sentinel for connection-bound binding.

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
  interface SchemaNode          // bare alphabet: { kind: string }
  interface Namespace           // first-class building block
  abstract class NamespaceBase  // convenience for implementers
  interface SchemaVerifier<TContract, TSchema>  // domain operation interface

Family (2-sql/, 2-mongo-family/)
  abstract class SqlNode extends SchemaNode             // SQL alphabet shape
  abstract class SqlTable extends SqlNode               // family abstract base
  abstract class SqlSchemaVerifier implements SchemaVerifier<...>

Target (3-targets/postgres/, 3-targets/sqlite/, 3-mongo-target/)
  class PostgresSchema extends NamespaceBase            // target concretion of framework concept
  class PostgresTable extends SqlTable                  // target concretion of family abstract
  class PostgresRlsPolicy extends SchemaNode            // target-only kind, no family parent
  class PostgresSchemaVerifier extends SqlSchemaVerifier // target concrete domain implementation
```

Targets concretize family abstract classes and add IR node kinds with no family-level counterpart. Framework consumers depend on framework interfaces; family-shared logic stays as utility functions or abstract bases that targets compose freely; targets that don't fit the family scaffolding can implement the framework interface directly.

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

Each layer extends the previous via interfaces + abstract base classes. Interfaces are the consumer contract; abstract classes carry shared behaviour. Targets that don't fit the family scaffolding can opt out and implement the framework interface directly; common SQL logic stays available either as utility code or as the family abstract base, whichever pays for itself.

### Domain interfaces follow the same layering

Verification, hydration, planning, and any other operation that walks the IR follow the same recipe as the IR itself: framework defines the interface, family ships an abstract base + utility code, target concretizes.

> _Illustrative — exact method shapes and generic parameters are up to the implementer:_
>
> ```ts
> // 1-framework/...
> interface SchemaVerifier<TContract, TSchema> {
>   verify(opts: { contract: TContract; schema: TSchema; ... }): VerifyResult;
> }
>
> // 2-sql/...
> abstract class SqlSchemaVerifier
>   implements SchemaVerifier<Contract<SqlStorage>, SqlSchemaIR>
> {
>   verify(opts: ...): VerifyResult {
>     // SQL-common walk: table existence, column shape, index satisfaction, FK columns
>     // dispatches to abstract methods for target-specific kinds
>   }
>   protected abstract verifyTargetExtensions(...): SchemaIssue[];
> }
>
> // 3-targets/postgres/...
> class PostgresSchemaVerifier extends SqlSchemaVerifier {
>   protected verifyTargetExtensions(...): SchemaIssue[] {
>     // walks PostgresSchema, PostgresFunction, PostgresEnum, future PostgresRlsPolicy
>   }
> }
> ```

The verifier is target-owned because target-specific IR demands target-specific consumers — the family layer cannot meaningfully verify a node kind it does not know exists. The framework's role drops to: declare the interface, aggregate the contract spaces into a multi-space input, dispatch to the right target verifier, format the result. Target-specific schema issues (e.g. an RLS policy mismatch) carry target-specific `kind` values in the resulting `SchemaIssue`; the issue taxonomy is extensible the same way the IR is.

The family abstract base is convenience, not gatekeeping. A target whose verification logic doesn't fit the SQL-shaped walk (e.g. a future graph-database target masquerading as SQL for some narrow purpose) can implement `SchemaVerifier` directly and skip the abstract base entirely.

### JSON canonical, classes canonical in-memory

Per ADR 192, the on-disk JSON form (`contract.json`, `ops.json`, future `schema.json` if persistence becomes useful) is the canonical artifact. Identity, attestation, auditability, and replay all key off the JSON form. This project does not change that.

What this project does change: the **in-memory** IR becomes a class hierarchy that round-trips through JSON without ceremony. Class fields are JSON-clean by construction (plain readonly properties, kind discriminant, no methods on properties, no `Map`/`Set`, no `Date` objects). `JSON.stringify(contract)` produces canonical contract.json directly; no `toJSON()` method needed. Hydration is target-owned: the hydrator reads `target: 'postgres'` from the JSON, dispatches to `PostgresContractHydrator`, validates the structural shape via arktype schemas, and constructs target-typed class instances.

> _Illustrative — exact API surface up to the implementer:_
>
> ```ts
> // round-trip
> const contract: Contract = validateContract(json);  // target-owned hydration
> const stringified: string = JSON.stringify(contract); // structurally identical to original json
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

### One rehydration route

`validateContract<TContract>(json)` keeps its public signature: input JSON, output `Contract`. What changes is its implementation — it now depends on the framework stack to dispatch to the target hydrator. Every existing call site already has the framework stack in scope; no consumers change. The framework consumer that wanted "cheap data, no classes" doesn't exist as a real role today: hashing reads a small number of fields, CLI display reads structured data the class instances expose identically. There is no second route; consolidating to one route is the simpler and consistent choice.

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
- A reserved sentinel `id: '__unspecified__'` represents "no namespace bound at authoring time; resolve from connection context." Targets without native namespacing use it as their default. Targets with native namespacing accept it for multi-tenancy contracts where the same schema is applied across multiple namespaces, with the connection's `search_path` (or equivalent) doing the binding.
- SQLite uses the singleton `__unspecified__` namespace; the SQL emitter elides namespace qualifiers when the namespace is the singleton.
- Mongo's analog (database name, if Mongo's binding semantics warrant it as a `Namespace`) or the singleton, decided in execution.

In Contract IR, every storage object (table, enum, function, …) belongs to a namespace. In Schema IR, every introspected object is namespace-scoped. The verifier walks two parallel trees of namespace-scoped objects and matches them up; `__unspecified__` collapses to whatever the connection's bind context resolved.

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
| IR node base               | `interface SchemaNode { kind }`              | `abstract class SqlNode extends SchemaNode` | (target-specific concrete classes)                      |
| Storage / contract root    | `interface Storage`                          | `abstract class SqlStorage`                 | `class PostgresStorage extends SqlStorage`              |
| Tables / collections       | —                                            | `abstract class SqlTable extends SqlNode`   | `class PostgresTable extends SqlTable`                  |
| Columns / fields           | —                                            | `abstract class SqlColumn extends SqlNode`  | `class PostgresColumn extends SqlColumn`                |
| Foreign keys               | —                                            | `abstract class SqlForeignKey`              | `class PostgresForeignKey extends SqlForeignKey`        |
| Namespace                  | `interface Namespace`, `abstract class NamespaceBase` | (passes through; SQL uses `NamespaceBase`)        | `class PostgresSchema extends NamespaceBase`            |
| Enum (refactor exemplar)   | (none required — family-shape concept)       | `abstract class SqlEnumType extends SqlNode` | `class PostgresEnumType extends SqlEnumType`           |
| Target-only kinds          | (must extend `SchemaNode`)                   | (none)                                      | `PostgresFunction`, future `PostgresRlsPolicy`, etc.   |
| Verifier                   | `interface SchemaVerifier<TContract, TSchema>` | `abstract class SqlSchemaVerifier` + utility helpers | `class PostgresSchemaVerifier extends SqlSchemaVerifier` |
| Hydrator                   | `validateContract<T>(json) → T` (single route, framework-stack-bound) | (family-shape arktype schema validation) | `class PostgresContractHydrator implements ContractHydrator` |
| Visitor (narrow ops)       | (none — visitor scope is domain-specific)    | `interface SqlSchemaVisitor<R>` for family-known kinds | Optional target-extended visitor `PostgresSchemaVisitor<R>` |

**Mongo family example** (lifted from today's family-level AST + new family/target split):

| Concept                    | Framework layer                              | Family layer (Mongo)                            | Target layer (Mongo)                                  |
|----------------------------|----------------------------------------------|-------------------------------------------------|-------------------------------------------------------|
| IR node base               | `interface SchemaNode { kind }`              | `abstract class MongoSchemaNode extends SchemaNode` (today's `MongoSchemaNode`, lifted to extend the framework interface) | (target-specific concrete classes)         |
| Storage / contract root    | `interface Storage`                          | `abstract class MongoStorage`                    | `class MongoTargetStorage extends MongoStorage`        |
| Collections                | —                                            | `abstract class MongoCollection extends MongoSchemaNode` | `class MongoTargetCollection extends MongoCollection` |
| Indexes / validators       | —                                            | `abstract class MongoIndex`, `abstract class MongoValidator` | `class MongoTargetIndex extends MongoIndex`, etc.    |
| Namespace                  | `interface Namespace`, `abstract class NamespaceBase` | (passes through)                          | Mongo's analog (database name) or `NamespaceBase` singleton, depending on Mongo's binding semantics |
| Verifier                   | `interface SchemaVerifier<TContract, TSchema>` | `abstract class MongoSchemaVerifier` + utility helpers | `class MongoTargetSchemaVerifier extends MongoSchemaVerifier` |
| Hydrator                   | `validateContract<T>(json) → T` (single route) | (family-shape arktype schema validation)      | `class MongoContractHydrator implements ContractHydrator` |
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

- **FR5.** Verification follows the same 3-layer pattern: framework `SchemaVerifier<TContract, TSchema>` interface; family abstract base (`SqlSchemaVerifier`, `MongoSchemaVerifier`) carrying SQL/Mongo-shared walk logic; target concrete classes (`PostgresSchemaVerifier`, `MongoTargetSchemaVerifier`).
- **FR6.** The framework verifier walks the contract-space aggregate, dispatches to the target's verifier per space, and returns a unified `VerifyResult`. Target-specific issue kinds are valid and propagate through the framework.
- **FR7.** Hydration follows the same pattern: framework `ContractHydrator` interface (or framework-stack-bound dispatch); target-owned hydrator that reads `target` from the JSON, validates structural shape via arktype, and constructs target class instances.
- **FR8.** `validateContract<TContract>(json) → TContract` keeps its existing public signature. Its implementation depends on the framework stack to resolve the target hydrator.

### Enums (refactor exemplar)

- **FR9.** Enum types are first-class IR nodes (`abstract class SqlEnumType extends SqlNode` at the family layer; `class PostgresEnumType extends SqlEnumType` at the target layer; analogous for any other SQL target that supports enums).
- **FR10.** Enum verification dispatches via the new IR pattern, not via `codecHooks.verifyType` / `expandNativeType`. The codec-hook glue specific to enums is removed; codecs continue to own their generic verification responsibilities for non-enum types.
- **FR11.** Existing enum migrations (`CreateEnumTypeCall`, `AddEnumValuesCall`, `DropEnumTypeCall`) consume the IR nodes directly without an intermediate translation layer.
- **FR12.** The authoring DSL surface for enums is preserved; users continue to declare enums the same way they do today. Internal lowering routes through the new IR.

### Namespace (new concept)

- **FR13.** `Namespace` is a framework-level interface with a convenience abstract base. Postgres ships `PostgresSchema extends NamespaceBase`; SQLite ships a singleton implementation; Mongo ships its analog (database name) or the singleton if its semantics warrant.
- **FR14.** A reserved sentinel namespace id `__unspecified__` represents connection-bound binding. Targets without native namespacing use it as their default; targets with native namespacing accept it for multi-tenancy / connection-context-resolved contracts.
- **FR15.** Every storage object in Contract IR and Schema IR belongs to a namespace. The verifier matches contract objects to schema objects via `(namespace.id, name)` rather than `name` alone.
- **FR16.** Existing single-namespace contracts migrate to the new shape: Postgres contracts get an explicit `public` namespace by default; SQLite contracts get the singleton; Mongo contracts get their analog. The migration is mechanical and the user's authored contract semantics are preserved.

### Mongo migration

- **FR17.** Mongo's existing `MongoSchemaNode` / `MongoSchemaVisitor` Schema IR is restructured into the 3-layer split (framework / family-mongo / target-mongo), with target-mongo concrete classes extending family-mongo abstract bases.
- **FR18.** Mongo's Contract IR (currently flat data shapes) is flipped to the AST-class pattern, layered family / target.

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

- **NFR1.** The on-disk JSON shape changes only to accommodate the new IR (notably namespace; minor field additions for kind discriminants where they're not already implicit). Breaking changes to existing contracts are acceptable (pure 0.x mindset); existing fixtures and examples are migrated as part of this project.
- **NFR2.** Round-trip fidelity: `validateContract(JSON.parse(JSON.stringify(contract)))` produces a contract structurally equivalent to the original. Tested for Postgres, SQLite, and Mongo.
- **NFR3.** No regression in the existing verifier's behaviour for cases the new IR can express. Tests for verification (existing `verifySqlSchema` test suite) pass after migration to the new architecture.
- **NFR4.** No silent loss of information. Anything previously stored in `annotations: SqlAnnotations` that becomes a first-class IR concept (currently: nothing planned beyond namespace; future: RLS) keeps working through the migration; anything that stays in `annotations` keeps round-tripping.
- **NFR5.** The pattern is documented as a project-wide convention — every domain interface that crosses the framework/target boundary follows the recipe (interface in framework, optional abstract base in family, concrete in target, target-can-skip-family escape valve). The convention is captured as an ADR at project close-out.
- **NFR6.** Layering is enforced by `pnpm lint:deps` after the refactor: framework does not import from family; family does not import from target; target imports family and framework as needed.
- **NFR7.** Hydration validates JSON structure via arktype schemas at the layer that owns each kind (framework schemas for framework kinds; family schemas for family kinds; target schemas for target-only kinds). Validation composes layer-by-layer.

## Non-goals

- **Cross-contract-space FK references** (`refIn(otherSpace, …)`). The IR refactor unblocks this work but the cross-space reference semantics, authoring DSL, and resolution rules are deferred to a separate project.
- **RLS policies as first-class IR.** The Postgres-side `RlsPolicy` node, authoring DSL, migration ops, and runtime session-state injection are deferred to the Supabase project (or a dedicated RLS project).
- **Supabase deliverables.** The `createSupabaseRuntime` factory, `auth.users` queryable surface, Supabase contract package, quickstart scaffold are all deferred. This project ships the IR foundation they need; nothing more.
- **Authoring DSL changes for namespace beyond the minimum needed.** Postgres contracts need a way to declare and reference namespaces (so `m.constraints.ref` can target `auth.users` within the same contract space). The minimum surface to achieve this is in scope; richer namespace authoring (e.g. namespace-as-module imports, namespace-scoped models, ergonomic shortcuts) is out of scope.
- **Migration of `databaseDependencies.init`-installed schemas** to first-class IR. That work belongs to the contract-spaces project, not this one.
- **Schema IR persistence on disk.** Schema IR remains an in-memory artifact for now; the round-trip pattern is established so persistence becomes mechanical if needed later.

# Acceptance Criteria

- [ ] **AC1.** Existing Postgres, SQLite, and Mongo test suites (unit + integration + e2e) pass after the IR refactor. Specifically: `verifySqlSchema` tests, planner tests, Mongo Schema IR tests, contract round-trip tests, integration tests against PGlite and `mongodb-memory-server`.
- [ ] **AC2.** Enum types are first-class IR nodes. After the enum exemplar lands, the codec-hook path for enum verification (`codecHooks.verifyType` / `expandNativeType` calls in `verify-sql-schema.ts` for the enum case) is removed; verification, planning, and contract round-trip of enums all flow through the new IR. Existing enum tests pass without semantic change.
- [ ] **AC3.** A target adds an IR node kind with no family-level counterpart (e.g. a stub `PostgresExtension` test fixture) without modifying framework or family code. The framework hydrator dispatches the kind to the target hydrator; the target verifier handles it; framework consumers (display, hashing) round-trip it through JSON.
- [ ] **AC4.** A Postgres contract declares two namespaces (`public` and `auth`) with tables in each. Verification against a live database with both schemas passes. FKs from `public.profiles` to `auth.users` (within the same contract space) are emitted as `ALTER TABLE public.profiles ADD CONSTRAINT ... FOREIGN KEY (user_id) REFERENCES auth.users(id)` and verified correctly.
- [ ] **AC5.** A SQLite contract uses the singleton `__unspecified__` namespace; the SQL emitter elides namespace qualifiers; the verifier matches contract to schema correctly.
- [ ] **AC6.** A multi-tenancy Postgres contract uses `__unspecified__` for its tables; the connection's `search_path` (or equivalent binding) resolves the namespace at runtime. Demonstrated end-to-end via a multi-tenancy integration test.
- [ ] **AC7.** Mongo's Contract IR and Schema IR are migrated to the 3-layer split; existing Mongo tests pass; the family/target boundary is observable in code (family-mongo abstract bases consumed by target-mongo concrete classes).
- [ ] **AC8.** `JSON.stringify(contract)` for any target produces JSON that, when re-hydrated via `validateContract`, yields a structurally equivalent class hierarchy. Verified via property tests.
- [ ] **AC9.** `AGENTS.md` / `CLAUDE.md` rule is updated; `docs/reference/typescript-patterns.md` gains the AST/IR class-hierarchy section; `docs/Architecture Overview.md` surfaces the two architectural principles. Reviewable as docs diffs in the project's PRs.
- [ ] **AC10.** ADR drafts capturing (a) the 3-layer polymorphic IR convention and (b) the architectural principles underwriting it exist under `projects/target-extensible-ir/specs/` (to be promoted to `docs/architecture docs/adrs/` at project close-out).
- [ ] **AC11.** `pnpm lint:deps` passes; no new layering violations are introduced. Layering rules are tightened where the new structure permits.

# Other Considerations

## Security

This project is an internal architecture refactor; no new user data flows or external surfaces are introduced. The existing security properties of `validateContract` (arktype validation of JSON shape before hydration) are preserved; the new hydrator dispatches to target-typed validation that is at least as strict as today's. Class instances cannot be constructed except via hydration or authoring DSL → both validated paths.

## Cost

No infrastructure cost. Internal engineering effort is the only cost — a sizeable refactor across the framework, sql-family, mongo-family, and three targets (postgres, sqlite, mongo). Cost ledger to be sized by the principal-engineer pass.

## Observability

The verifier's existing diagnostic surface (`SchemaIssue.kind`, `VerifyDatabaseSchemaResult`) remains; target-specific issue kinds are now first-class (currently: nothing new beyond namespace mismatch; future: RLS-policy-mismatch, function-shape-mismatch, etc.). CLI display of verification results is unchanged for users; the diagnostics may be richer when targets emit target-specific issue kinds.

## Data Protection

No personal data flows are touched. Contract content is metadata describing schema structure, not user data.

## Analytics

Not applicable.

# References

- [ADR 195 — Planner IR with two renderers](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md). The `OpFactoryCall` precedent — frozen-class IR with target-owned union, JSON-clean fields, kind discriminant, target abstract base, target concrete classes. The recipe this project applies to Contract IR and Schema IR.
- [ADR 192 — ops.json is the migration contract](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md). The JSON-canonical / class-in-memory round-trip pattern proven for migration ops; this project extends it to Contract IR and Schema IR.
- [ADR 196 — In-process emit for class-flow targets](../../docs/architecture%20docs/adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md). The hydration-by-class-flow pattern; informs how `validateContract` resolves the target hydrator.
- [ADR 187 — MongoDB schema representation for migration diffing](../../docs/architecture%20docs/adrs/ADR%20187%20-%20MongoDB%20schema%20representation%20for%20migration%20diffing.md). The existing AST-class pattern for `MongoSchemaIR`; this project promotes it to the framework layer.
- [ADR 188 — MongoDB migration operation model](../../docs/architecture%20docs/adrs/ADR%20188%20-%20MongoDB%20migration%20operation%20model.md). Sibling pattern at the migration-op layer for Mongo.
- `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` — concrete reference implementation of the `OpFactoryCall` pattern; the structural template for target IR class hierarchies.
- `packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts` — concrete reference implementation of the AST-class pattern for Schema IR.
- [ADR 185 — SPI types live at the lowest consuming layer](../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — the dependency-inversion / SPI pattern this project's domain interfaces follow (verifier, hydrator, etc.).
- [`docs/Architecture Overview.md`](../../docs/Architecture%20Overview.md) § "Guiding Principles" — gets updated as part of this project (FR23) to surface the architectural principles underwriting the convention.
- [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" — gets a sibling section as part of this project (FR22) to document the AST/IR class-hierarchy pattern.
- [`AGENTS.md`](../../AGENTS.md) / [`CLAUDE.md`](../../CLAUDE.md) line 93 — gets updated as part of this project (FR21) to split the "Interface-Based Design" rule along the service-vs-AST/IR axis.
- [`projects/extension-contract-spaces/spec.md`](../extension-contract-spaces/spec.md) — sibling in-flight project; this project's IR refactor is a natural complement (contract-space-aware contract.json layering benefits from a target-extensible IR but does not depend on it).

# Open Questions

These are residual decisions left for the principal-engineer pass and execution. None of them require re-opening Context.

1. **Order of refactors.** The structural sequencing is settled (enums first as the low-risk refactor exemplar, namespace second as the new-concept exemplar). What remains open is how the *infrastructure* (framework interfaces + family abstract bases + Mongo migration) sequences relative to the exemplars: (a) lay all infrastructure first then build enum + namespace on top; (b) infrastructure-just-in-time per exemplar; (c) Mongo migration as a separate parallel stream. PE judgement.

2. **Migration of existing fixtures.** Big-bang refactor of all `contract.json` fixtures, examples, and integration tests in one PR vs. incremental dual-shape support during a transition window. Pure 0.x suggests big-bang; PE pass should pressure-test the actual blast radius and choose.

3. **Family abstract bases vs. utility functions, case by case.** SQL has `verify-helpers.ts` already as utility functions; the family abstract base may end up thin (just `verifyTargetExtensions` as a hook). The line between "lift to abstract base" and "leave as utility code targets compose" is a judgment call per concept; PE should make these calls during execution rather than pre-pinning them in the spec.

4. **Cross-namespace FK within a single contract space.** A natural consequence of having namespaces in the IR + FKs that reference tables. Treating it as in-scope is cheap (FK references gain a `namespace.id` field; verifier and planner-DDL builders dispatch on it); deferring it leaves namespace half-baked for Postgres users with multiple schemas. **Default assumption: in scope** as a natural completion of the namespace work; flag if PE judges otherwise.

5. **`validateContract` framework-stack wiring mechanism.** Settled to be cosmetic (registry, curried factory, facade method). PE picks based on which fits the existing CLI / runtime composition most naturally.

6. **Authoring DSL surface for namespace declarations.** Minimum needed: a way to declare namespaces in a Postgres contract (`defineContract` extension) and reference them (`m.constraints.ref` namespace-aware target). Exact API shape (top-level `namespaces` block? per-model `namespace` field? something else?) is a small DSL design question for execution.

7. **Schema IR persistence.** Currently in-memory only. Whether to ship `schema.json` round-trip as part of this project or defer until a consumer needs it (offline planning fixtures, schema snapshots for review). **Default assumption: defer**, but note the round-trip pattern is established and persistence becomes mechanical when needed.

8. **Mongo Contract IR scope.** The mechanical migration (flip `type =` data to AST-class) is in scope. Whether to also unify Mongo's currently-disjoint `MongoIndex` / `MongoIndexOptions` / `MongoCollationOptions` types into the new class hierarchy (vs. keeping them as nested data within class instances) is a judgment call on how far the Mongo refactor goes. PE pass.
