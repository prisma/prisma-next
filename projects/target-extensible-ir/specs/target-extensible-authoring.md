# ADR (draft) — Target-extensible authoring: pack-contributed entities via descriptor + factory

> **Status:** Draft, ready for promotion (lives under `projects/target-extensible-ir/specs/` while the project executes; promoted to `docs/architecture docs/adrs/` with a permanent ADR number at project close-out — after PR2 lands the namespace exemplar). The mechanism has been exercised end-to-end against the M4 enum exemplar (Postgres pack contributes `helpers.entities.enum`; the family contract-builder dispatches through it; the family-layer deserializer dispatches through the registry; the codec-hook glue specific to enums was deleted as the M4 round's worked example). M5a's namespace exemplar in PR2 is the final pressure test before promotion.
>
> **Shipped at M3.5 R1 — small deviation from this draft:** the descriptor's `schema` field, as drafted below as a required `ArktypeSchema<unknown>`, ships as an optional `args?: readonly AuthoringArgumentDescriptor[]` (mirroring the existing `field` / `type` descriptor shape). For factory-output entities, the input type comes from the factory's parameter signature directly (extracted via `EntityHelperFunction<Descriptor>`'s conditional inference) and no descriptor-level input schema is needed; for template-output entities, the `args` argument-descriptor list is validated at call time by the existing `validateAuthoringHelperArguments` walker that today covers `field` / `type`. Adding a richer arktype-validated `schema` field for cross-runtime input validation is a forward-compatible addition admissible later without changing the descriptor's tagged-union shape. The lifted family-agnostic scaffolding ships in [`@prisma-next/contract-authoring/composed-helpers-scaffolding.ts`](../../../packages/1-framework/2-authoring/contract/src/composed-helpers-scaffolding.ts); SQL + Mongo contract-builders consume it; the in-tree synthetic pack exemplar at [`packages/2-sql/2-authoring/contract-ts/test/entities-namespace.exemplar.test.ts`](../../../packages/2-sql/2-authoring/contract-ts/test/entities-namespace.exemplar.test.ts) verifies the end-to-end mechanism (type narrowing, factory dispatch, JSON-cleanliness). The Mongo built-in entity construction sites (the M2 R2 hand-imported `MongoCollection` / `MongoIndex` / `MongoCollectionOptions` instantiations in [`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts`](../../../packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts)) are **deferred** to a tracked open item per Decision 17; they're orthogonal to the mechanism and to M4 / M5a, which contribute their entities through the new mechanism regardless.
>
> **Refined at M7 — two PR1-review-driven changes folded into this draft:**
>
> 1. **Asymmetric naming `entityTypes` (contribution) vs `entities` (helpers).** The contribution slot is `AuthoringContributions.entityTypes` and the user-facing helpers slot is `helpers.entities`. PR1 review surfaced that the original symmetric `entities` naming overloaded the word in three meanings, with the contribution-surface usage conflicting with the application-domain meaning every fresh contributor reaches for first. The asymmetry reads honestly at each altitude: a pack ships entity types; a contract author constructs entities. The composed-helpers template performs the one-step rename in the type system; no runtime cost.
> 2. **Registry-driven family-layer deserialization.** The descriptor gains a required `discriminator: string` field carrying the `kind` tag the contributed IR-class instance writes into its on-disk JSON envelope (e.g. `'sql-enum-type'`). At hydration time, the family contract-serializer dispatches through a `ReadonlyMap<discriminator, EntityHydrationFactory>` registry built from the resolved authoring contributions in scope for the contract; no per-kind hooks live on family bases. The same factory function used at authoring time is the hydration factory (input shape and JSON shape are the same for first-class entities, by construction). Adding a new pack-contributed entity type requires zero family-base changes. The pre-M7 shape (per-kind `hydrateEnumType` SPI hook with a throwing default + duck-typed `kind === 'sql-enum-type'` dispatch in the family base) was a load-bearing architectural defect surfaced by PR1 review (architect SDR § 3.3; principal-engineer F-pass) and closed in M7.
>
> **Project:** [target-extensible IR (TML-2459)](../spec.md). Drafted alongside the M3.5 milestone. Refined throughout M4 (enum exemplar — first real consumer) and M5a/b (namespace exemplar — greenfield consumer).
>
> **Companion ADRs:** [3-layer polymorphic IR convention](3-layer-polymorphic-ir-convention.md) and [Architectural principles: affordances and cross-target consistency](architectural-principles.md). The 3-layer convention makes the *IR* target-extensible; this ADR makes the *contract authoring surface* target-extensible. Both are operational consequences of the architectural principles — particularly principle 1 (the framework provides affordances; targets implement specifics).

## At a glance

A target-extensible IR is only as extensible as the contract authoring surface that constructs it AND the deserializer that reconstructs it from disk. Once the IR admits target-specific kinds (`PostgresEnumType`, `PostgresSchema`, future `PostgresRlsPolicy`, future `PostgresView`), three boundaries need extension points: (1) the contract authoring surface so target packs can ship construction helpers; (2) the deserializer so the family-layer hydration walker doesn't need to know per-kind classes; (3) the type system so user-facing helpers narrow per pack. This ADR codifies all three through one mechanism.

The mechanism: extend `AuthoringContributions` with a new **`entityTypes`** namespace. Every entity-type contribution is a descriptor with a **discriminator** (the `kind` tag the contributed IR-class instance writes into its on-disk JSON envelope), an optional **args** descriptor list (input shape — PSL/TS lowest-common-denominator), and an **output mechanism** that is either a declarative template (preferred where expressible — same `AuthoringTemplateValue` shape used by today's `field` / `type` outputs) or a **factory function** `(input) => IRNode` constructing an IR-class instance from validated input. Both authoring runtimes (PSL and TS DSL) reach the same factory through the same descriptor. The family-layer deserializer dispatches on the entry's `kind` discriminator through a contribution-driven registry built from the union of every pack's `entityTypes` — no per-kind hooks on family bases. Pack-bag-driven type narrowing surfaces contributed entities at `helpers.entities.<entityName>(input)` (asymmetric naming: packs ship `entityTypes`; users construct `entities`) via the existing `MergeExtensionXxx<Packs>` + `UnionToIntersection` template that today merges `field`, `type`, codec, and SQL index contributions.

The `composed-authoring-helpers.ts` scaffolding ([currently SQL-only](../../../packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts)) is lifted to a family-agnostic location so both SQL and Mongo contract-builders consume the same scaffolding. Both family contract-builders are wired to surface `helpers.entities` to their `defineContract` factories. The two structural exemplars (M4 enum, M5a/b namespace) become the first real consumers — enum proves the "lift target-specific glue into a pack contribution" path; namespace proves the "introduce a new framework-level kind via a pack contribution" path.

## Context

### What "entity" means in this ADR

The word "entity" carries three distinct meanings in the codebase that share the term without conflict:

1. **Visualisation discriminant** — `SchemaNodeKind = 'entity'` in [`packages/1-framework/1-core/framework-components/src/control/control-schema-view.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-schema-view.ts), used by CLI rendering to tag a schema-node as a top-level entity for layout. Pre-existing; unchanged by this ADR.
2. **Contribution-kind namespace** (introduced here) — the `entityTypes` namespace on `AuthoringContributions`. Contributions in this namespace are *kinds* of contract-authoring-domain entities packs can ship: models, namespaces, enums, future RLS policies, roles, views.
3. **Application-domain instance** — the user's authored `User`, `Invoice`, `Product` — *instances of* the kinds packs contribute. These are the entities the user's application is *about*.

The contribution-kind namespace is meta-level: packs ship `entityTypes.namespace`, `entityTypes.enum`, `entityTypes.policy` (kinds); users construct `User`, `Invoice`, `Profile` (instances) via `helpers.entities.<name>(input)`. The asymmetric naming at the two surfaces (`entityTypes` for the pack contribution; `entities` for the user-facing helpers) is deliberate — each surface uses the word the consumer of *that* surface naturally reaches for. The three meanings share the root word with no semantic conflict, and the asymmetric surface naming reinforces the kind-vs-instance distinction at the points where contributors and users encounter it.

### The gap M2 R2 surfaced

M2 R2 close-out flagged an architectural tension. The Mongo Contract IR is now polymorphic and target-extensible (M2 R2's storage-shape class flip per FR18). But the family-layer contract builder ([`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts`](../../../packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts)) directly instantiates `MongoCollection`, `MongoIndex`, `MongoValidator` — concrete IR classes that should belong to the target layer if the IR is to be honestly extensible. The builder cannot extend the family→target dep edge to reach those classes (the dep edge already runs the wrong direction and is being severed in M2.5), so the builder ends up either pulling target-IR classes into the family layer (compromising the layering) or hand-editing family-layer construction sites every time a target adds a kind.

The same gap exists symmetrically on the SQL side: `packages/2-sql/2-authoring/contract-ts` is at the family layer; it does not depend on the target packages; but the IR classes it constructs would in a fully target-extensible world live in the target layer (`PostgresTable extends SqlTable`, etc.). Today the SQL-side gap is hidden because SQL Contract IR has not yet been flipped to the polymorphic shape (that's M3); it surfaces at M3 the moment SQL adopts the convention.

The architectural ask: the contract-authoring surface needs an extension point so target packs can ship contract authoring kinds without the family layer having to know they exist. The mechanism must work for both PSL and TS DSL authoring, must not regress type narrowing, and must not multiply the contribution surface across families.

### Existing extension points the codebase already proves

Three pre-existing patterns inform the design:

- **`AuthoringContributions` with `field` and `type` namespaces** ([`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`](../../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts)). Packs already contribute field presets and type constructors via descriptors with declarative-template outputs. Both PSL and TS DSL consume the same descriptors through a shared interpreter; the contribution shape is the lowest common denominator across authoring runtimes.

- **Codec descriptors with factory functions** (`codecDescriptors[].factory` on `PackRefBase`, exercised in [`packages/1-framework/1-core/framework-components/src/control/control-stack.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-stack.ts)'s `extractCodecLookup`). Pack refs already carry runtime factory functions alongside JSON-shaped descriptors. The "JSON-friendly contributions only" framing in `PackRefBase`'s docstring is aspirational; codecs already prove that pack-side factories are admissible when computation can't be templated.

- **Pack-bag-driven type narrowing** (`composed-authoring-helpers.ts`, `MergeExtensionXxx<Packs>` + `UnionToIntersection`). The contract user passes a list of packs to `defineContract`; the resulting `helpers` object is a typed merge of all contributions from all packs in the list, narrowed via type-system machinery already in production for `field`, `type`, codec, and SQL index contributions. Type narrowing is not a research problem — the template exists, the in-tree exemplar (paradedb's `indexTypes` contribution) ships in production.

The mechanism this ADR codifies is the composition of these three existing patterns applied to a fourth namespace (`entities`).

### Why this surfaces now, not in M1

M1 froze the *IR* shape (`IRNodeBase`, `Storage`, the SPI interfaces) and named the family/target split. The IR shape is target-extensible by construction at the framework layer — a target ships an IR-class concretion and the framework SPIs walk it. What M1 did not address: **how does the contract authoring surface — the part of the system the user actually calls — produce target-extended IR class instances?** M1's tasks named "framework + family compile in isolation; no consumers exist". M2 wired the first consumer (Mongo) and surfaced the gap.

The M3.5 placement (after M3, before M4) reflects the gap's real shape:
- Earlier than M3 means SQL has not yet adopted the polymorphic IR, so the mechanism would have nothing to wire on the SQL side.
- Later than M4 means the enum exemplar has to be hand-edited at the family layer first and then re-extracted into a contribution — pure waste.

## Decision

### `AuthoringContributions` gains an `entityTypes` namespace

Add `entityTypes` next to the existing `field` and `type` namespaces on `AuthoringContributions`:

```ts
interface AuthoringContributions {
  field?: AuthoringFieldNamespace;
  type?: AuthoringTypeNamespace;
  entityTypes?: AuthoringEntityTypeNamespace;  // new
}

interface AuthoringEntityTypeNamespace {
  [name: string]: AuthoringEntityTypeDescriptor;
}

interface AuthoringEntityTypeDescriptor {
  kind: 'entity';
  discriminator: string;            // kind tag the IR-class writes into its JSON envelope
  args?: readonly AuthoringArgumentDescriptor[];  // input shape (template-output path)
  output:
    | { template: AuthoringTemplateValue }            // preferred where expressible
    | { factory: (input) => IRNode };                  // for class-instance outputs
}
```

The descriptor's `discriminator` is the load-bearing identifier the deserializer registry looks up at hydration time (Decision § "Family-layer deserializer dispatches through a contribution-driven registry" below). For factory-output entities, input typing comes from the factory's parameter signature; for template-output entities, the `args` argument-descriptor list is validated at call time by the existing `validateAuthoringHelperArguments` walker that today covers `field` / `type`. The `output.template` path covers contributions whose result can be expressed as a declarative AST. The `output.factory` path covers contributions whose result is a class instance that carries methods, freeze semantics, and per-class identity — most or all `entityTypes` contributions today, because IR-class instances are the contribution's whole point.

### One contribution surface for both authoring runtimes

Both PSL and TS DSL reach the same `output` (template or factory) through the same descriptor. The PSL interpreter validates parsed input against the descriptor's `schema` and dispatches to the output mechanism; the TS DSL surfaces a typed callable `(input) => instance` whose body validates and dispatches the same way. There is no parallel "PSL-only contribution" or "TS-only contribution" surface — the contribution is the descriptor, and the authoring runtimes are interpreters of that descriptor.

This avoids the historical drift where TS DSL extensions could express things PSL extensions could not, by forcing every contribution through the lowest-common-denominator schema shape.

### Pack-bag-driven type narrowing surfaces contributions at `helpers.entities.<name>` (asymmetric naming)

The `ComposedAuthoringHelpers<Family, Target, ExtensionPacks>` template gains an `entities` member that merges every contributing pack's `entityTypes` namespace via the existing `MergeExtensionXxx<Packs>` + `UnionToIntersection` template that today merges `field`, `type`, codec, and SQL index contributions:

```ts
type ComposedAuthoringHelpers<F, T, P> = {
  field: MergeExtensionFields<P>;
  type: MergeExtensionTypes<P>;
  entities: MergeExtensionEntityTypes<P>;  // packs ship `entityTypes`; helpers expose `entities`
  // ...
};
```

The user's `defineContract` factory receives `helpers: ComposedAuthoringHelpers<Family, Target, ExtensionPacks>` as before; `helpers.entities.<entityName>(input)` is the new surface. The asymmetric naming (`entityTypes` at contribution; `entities` at helpers) is deliberate — see Context § "What 'entity' means in this ADR". The composed-helpers template performs the one-step rename in the type system; no runtime cost. Type narrowing on `input` follows the contributing pack's descriptor schema. Collisions across packs are detected at compose time per the existing `assertNoCrossRegistryCollisions` discipline.

### Family-layer deserializer dispatches through a contribution-driven registry

When a family contract-serializer (e.g. `SqlContractSerializerBase`) hydrates its `storage.types` (or any other IR slot admitting pack-contributed first-class entities), it dispatches on each entry's `kind` discriminator through a `ReadonlyMap<discriminator, EntityHydrationFactory>` registry built from the resolved authoring contributions in scope for the contract:

```ts
abstract class SqlContractSerializerBase<TContract extends Contract<SqlStorage>>
  implements ContractSerializer<TContract>
{
  constructor(private readonly entityRegistry: ReadonlyMap<string, EntityHydrationFactory>) {}

  protected hydrateStorageTypeEntry(entry: SqlStorageTypeEntry): SqlStorageTypeEntry {
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind === 'string') {
      const factory = this.entityRegistry.get(kind);
      if (factory) return factory(entry);
    }
    return entry;  // codec-typed entries pass through unchanged
  }
}
```

The registry is constructed at descriptor-build time from the union of every pack's `entityTypes` contributions, keyed by each contribution's `discriminator` field. The Postgres descriptor builds the registry from `postgresAuthoringEntityTypes` (and any extension packs in scope) and passes it to the `PostgresContractSerializer` constructor. The same factory function used at authoring time is the hydration factory — input shape and JSON shape are the same for first-class entities, by construction.

**The family base does not import per-kind IR classes.** It does not declare per-kind `hydrateXxx` SPI hooks. It does not perform `if (kind === '<literal>')` branches on specific kinds. Adding a new pack-contributed entity type — RLS policy, role, view, future Postgres-domain entities — requires zero family-base changes. The contributing pack ships the descriptor + factory + discriminator and the registry routes through it.

The pre-M7 shape (per-kind `hydrateEnumType` SPI hook with a throwing default + duck-typed `kind === 'sql-enum-type'` dispatch in the family base, plus an explicit `import { SqlEnumType }` in the family base) was a load-bearing architectural defect — the family layer carried privileged knowledge of one specific entity kind, which is exactly the smell the entities mechanism exists to eliminate. Surfaced by PR1 review (architect SDR § 3.3; principal-engineer F-pass) and closed in M7.

### Lift `composed-authoring-helpers.ts` to a family-agnostic location

The current file lives at `packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts` with SQL-flavoured type parameters (`TargetPackRef<'sql', string>`, etc.). Lift the family-agnostic merge / instantiation scaffolding to a shared location (likely `@prisma-next/contract-authoring`) so Mongo can mirror without re-deriving. SQL-specific helper composition stays where it is and imports the lifted scaffolding. The Mongo contract-builder consumes the same lifted module.

### Wire both family contract-builders

Both `packages/2-sql/2-authoring/contract-ts` and `packages/2-mongo-family/2-authoring/contract-ts` consume the lifted scaffolding and surface `helpers.entities` to their `defineContract` factories. Hand-edited family-layer construction sites that today directly instantiate target IR classes are replaced by entity contributions on the contributing pack. The family contract-builder no longer holds a reference to any target IR class; it holds a reference to the pack-contributed factory and dispatches to it.

## Consequences

### What this enables

- **Target packs ship IR kinds end-to-end without family-layer edits.** Postgres ships `PostgresEnumType` (M4), `PostgresSchema` (M5a), and future `PostgresRlsPolicy`, `PostgresView`, `PostgresRole` by adding entity-type contributions to the postgres-target pack's `authoring.entityTypes`. The family contract-builder neither knows nor needs to know these kinds exist; it dispatches via the pack-contributed factory at authoring time and via the registry at hydration time.
- **The PSL/TS authoring drift question stops recurring.** Every contribution is a descriptor; both runtimes interpret the same descriptor; no contribution can be TS-only or PSL-only. The "what can PSL not express that TS can?" question collapses into "what does the descriptor's schema not admit?" — a shape question, not a runtime-availability question.
- **Type narrowing scales without per-namespace machinery.** Adding the `entityTypes` namespace is a copy of the existing `field` / `type` machinery applied to a fourth namespace. Every future namespace (if any) follows the same template.
- **Family-layer deserializer hooks scale O(1) with new entity kinds.** The pre-M7 shape required a new `hydrateXxx` SPI hook on the family base (and a corresponding override on every concrete target serializer) for every new pack-contributed entity kind — O(N) hooks for N kinds, with the family base accumulating per-kind imports. The registry-driven shape adds zero hooks per new kind: the contributing pack's descriptor's `discriminator` field and `output.factory` together fully define hydration. The family base imports zero per-kind IR classes.
- **Hand-edited family-layer construction sites disappear from the contract-builder.** The Mongo gap diagnosed at M2 R2 close-out — and the structurally identical SQL gap that surfaces at M3 — both resolve via this mechanism without further family-layer edits.
- **Ecosystem extensibility scales.** A third-party pack (Supabase, Cockroach, third-party Postgres extensions) adds entity contributions to its own pack ref; users include the pack in their contract's pack list; the new entities surface in `helpers.entities` with full type narrowing. No fork of the framework, no fork of the family layer.

### What this costs

- **A third descriptor shape coexists with two existing ones.** `field` and `type` descriptors today carry `output` as a declarative `AuthoringTemplateValue`. `entityTypes` descriptors admit both template-output and factory-output, and additionally require the `discriminator` field for registry dispatch. The dispatch on `output.kind` is one switch in the interpreter; the cost is mild but real (and TML-2513 closes it by backporting the dual-output shape to `field` and `type` so all three namespaces dispatch identically — `field` / `type` would not gain `discriminator`, which is specific to first-class entity hydration).
- **Heavy-generics relocation.** Lifting `composed-authoring-helpers.ts` is a heavy-generics move. The lifted module's type parameters need to be family-agnostic; the SQL-specific composition stays where it is and re-imports. The risk is regressing type narrowing for in-tree consumers; the M3.5 validation gate calls `pnpm typecheck` workspace-wide as the regression guard.
- **Pack-bag declaration discipline.** Users must declare pack lists at `defineContract` invocation time so the type narrowing has a packs-set to merge. Today's contracts already do this; the discipline is unchanged.
- **PSL surface cost for greenfield kinds.** New entity kinds with no PSL precedent (M5a's namespace, future RLS policies) need PSL grammar additions. The contribution mechanism does not eliminate that work — it absorbs the construction site, not the parser. PSL grammar work remains a per-kind cost.

### What this rules out

- **Per-target contract builder packages.** Earlier shaping considered shipping `@prisma-next/postgres-contract-ts`, `@prisma-next/sqlite-contract-ts`, etc., where each target ships its own builder that knows its concrete IR classes. Rejected: forces the user to import a different builder per target; multiplies the maintenance surface; and fragments the family-shared abstractions (`SqlTable` semantics, FK shapes) across N target packages.
- **Hand-edited family-layer construction sites.** Once M3.5 lands, the family contract-builder must not directly import any target IR class. Direct imports become a layering smell flagged by `pnpm lint:deps` or PR review.
- **Per-kind `hydrateXxx` SPI hooks on family bases.** Once M7 lands, the family contract-serializer must not declare per-kind hydration hooks (e.g. `hydrateEnumType`, `hydrateRlsPolicy`) and must not import per-kind IR classes. Hydration dispatches generically through the registry. New per-kind hooks become an architectural regression, equivalent to an `if (kind === '<literal>')` branch on a specific pack-contributed entity kind.
- **Builder mixin / class-extension extension model.** A model where target packs ship classes that extend the family contract-builder's builder classes (`class PostgresContractBuilder extends SqlContractBuilder { /* adds .enum() */ }`). Rejected — see § Alternatives considered.
- **JSON-only contributions for IR classes.** A model where pack contributions emit only JSON shapes and the framework synthesises generic IR-node wrappers from those shapes. Rejected — see § Alternatives considered.

## Alternatives considered

### Alternative 1: Declarative-template-only contributions for entities

Treat `entities` contributions like today's `field` / `type` contributions — descriptors with `output: { template: AuthoringTemplateValue }`. The framework synthesises a generic IR-node wrapper at construction time from the template's evaluated output.

**Why considered.** Templates are the lowest common denominator across authoring runtimes; PSL has no module imports, so anything templateable transports across PSL and TS by construction. The framework would synthesise the IR-class wrapper, keeping pack contributions to pure data and preserving the "JSON-friendly contributions" framing on `PackRefBase`.

**Why rejected.** Loses per-class methods (`accept(visitor)` on `MongoSchemaNode` and analogous methods on future kinds), loses `freeze()`-in-constructor semantics, loses per-class type narrowing for callers holding an instance (`PostgresColumn.nativeType` is a typed field on a class instance, not a path through a generic wrapper). Effectively makes target-extensible IR kinds *not-first-class IR* — they become wrappers around data instead of concrete subclasses. The whole point of the M2 R2 / M3 polymorphic-IR shape is that target-extended kinds are first-class IR classes; declarative-template-only output sacrifices that to preserve a "JSON-only contributions" purity that codec descriptors already break.

### Alternative 2: Builder emits JSON; framework hydrates

Pack contributions emit JSON shapes (via templates or factories returning JSON); the framework's `ContractSerializer.deserializeContract` then hydrates the JSON into target IR classes using the existing M2/M3 hydration walker.

**Why considered.** Reuses the existing serializer infrastructure. Keeps pack contributions to pure data (or pure JSON-producing factories). The IR class hydration already exists at M2/M3; adding entity contributions could route through it.

**Why rejected.** Confuses two different boundaries. The `ContractSerializer` SPI's `deserializeContract` takes a *whole contract's JSON* and reconstructs the contract IR; it is the JSON ⇄ classes seam at the persistence boundary. Pack-contributed entity construction is the *authoring* seam — the surface the user calls to *produce* a contract IR in memory. Routing the authoring path through serialization-shaped code adds a serialize-then-deserialize round-trip on every authoring call (cost), conflates "the user authored this" with "we read this from disk" in the IR class's lifecycle, and forces the contribution's input shape to be expressible as JSON-shaped serialized output (every authoring helper would need a parallel serializable representation). The factory-on-the-descriptor path is direct: input → factory → IR-class instance, no detour.

### Alternative 3: Builder mixin / class extension

Target packs ship classes that extend the family contract-builder's builder classes — `class PostgresContractBuilder extends SqlContractBuilder { enum(...): PostgresEnumType { ... } }`. The user imports the target-specific builder class and chains target-specific methods.

**Why considered.** Maps cleanly to OO intuition — "Postgres extends SQL by adding enum support". Each target's surface is its own class; no merge gymnastics; no `helpers.entities` indirection.

**Why rejected.** Three problems. First, multiple-pack composition becomes class-multiple-inheritance — a contract that uses Postgres + paradedb + cipherstash needs `class XXX extends PostgresContractBuilder` + ext from paradedb + ext from cipherstash; TypeScript class inheritance is single-parent. Second, the user's import path becomes target-coupled (`import { defineContract } from '@prisma-next/postgres-contract-ts'`) instead of family-coupled (`import { defineContract } from '@prisma-next/contract-ts'`); mixing targets in the same contract becomes structurally awkward. Third, the mechanism gives no PSL surface — PSL has no class-method dispatch — so the "one descriptor for both authoring runtimes" property is lost. The pack-bag-driven type-narrowing approach handles all three (composition is structural type-merge; user imports stay family-shaped; PSL and TS reach the same descriptor).

### Alternative 4: Sub-builder dispatch (mid-chain extension)

Target packs contribute methods that extend mid-chain fluent builder positions — `model('User').field('email').encrypted({ algorithm: 'AES-256' })` where `.encrypted()` is contributed by the cipherstash pack at the `ScalarFieldBuilder` chain position.

**Why considered.** Real-world use case (cipherstash already wants exactly this, and other extension packs will). The mid-chain shape is ergonomic when the contribution attaches to an existing position in the chain.

**Why rejected — for this project.** Different type-system shape from top-level entity contributions. Mid-chain extension requires the contributing pack to declare which builder type it extends and at which chain positions; the framework's builder type then needs to be widened to admit pack-contributed methods at those positions. This is a richer type-system problem than top-level entity contributions (which slot into a fresh `helpers.entities` namespace with no chain-position concerns). The full design would be the *attribute* contribution surface in the entity / attribute / relationship vocabulary; it warrants its own design effort, separate from this project's scope. **Tracked as a follow-up project**; admitted to the roadmap when a use case demands it (cipherstash, when it lands, is the obvious driver).

### Alternative 5: Per-target contract-builder packages

Ship `@prisma-next/postgres-contract-ts`, `@prisma-next/sqlite-contract-ts`, `@prisma-next/mongo-contract-ts` — each at the *target* layer, each owning the IR-class construction sites for its target. Users import the target-specific contract-builder for the target they're authoring against.

**Why considered.** Solves the layering problem mechanically: the target-layer contract-builder has the dep edges to reach target IR classes directly. No descriptor + factory machinery; no merge type machinery; no cross-cutting `entities` namespace.

**Why rejected.** Fragments family-shared abstractions. A SQL contract is a SQL contract; the abstractions a SQL-family contract-builder ships (`model(...)`, `field(...)`, FK constraints, indexes) are family-shared, not per-target. Splitting them across N target packages forces every change to a family abstraction to ripple across N target builders (and the alternative — putting the family abstractions in a shared package the target builders import from — collapses to today's family-layer builder, just with a thin per-target wrapper). The user's import surface also fragments: a contract that wants to use Postgres-only and Mongo-only kinds (rare today, plausible tomorrow) needs two builder imports and two `defineContract` calls. The pack-bag mechanism keeps the user surface family-coupled and absorbs the per-target IR construction at the contribution layer where it belongs.

### Alternative 6: Stay declarative; use a generic node-class wrapper

Pack contributions ship descriptors with declarative-template output; the framework synthesises an IR-node wrapper at construction time that satisfies `IRNode` but is not a target-specific subclass.

**Why considered.** Combines alternative 1's "declarative-only" property with alternative 2's "framework synthesises the IR shape" property. Avoids factory functions on pack refs entirely.

**Why rejected.** Same problems as alternative 1, plus an additional one: the framework's wrapper class needs a runtime way to discriminate the wrapped contribution's kind (so verifiers, planners, and other consumers can dispatch on it). The wrapper either carries a string `kind` field (which the consumer dispatches on — but then all wrapped contributions share the same wrapper class and the consumer cannot use `instanceof PostgresEnumType` for type narrowing), or carries a per-contribution synthesised subclass (which means the framework synthesises classes at runtime — defeats the "declarative-only" framing the alternative was supposed to preserve). Either way, the synthesised-wrapper path doesn't deliver first-class polymorphic IR; it delivers wrapped data with extra steps.

## Open questions (for the close-out promotion)

- **Lifted scaffolding location — pinned.** The lifted family-agnostic scaffolding ships in [`@prisma-next/contract-authoring/composed-helpers-scaffolding.ts`](../../../packages/1-framework/2-authoring/contract/src/composed-helpers-scaffolding.ts). Both the SQL contract-builder (`packages/2-sql/2-authoring/contract-ts`) and the Mongo contract-builder (`packages/2-mongo-family/2-authoring/contract-ts`) consume it without circular deps. Close-out promotion folds this into the Decision § text.
- **Does the `output` discriminator stay `template | factory`, or generalise further?** M3.5 + M4 ship exactly two output kinds; M4's enum exemplar is factory-shaped (IR-class instance output); M5a's namespace exemplar (PR2) is also factory-shaped. No in-tree consumer has surfaced a need for a third output kind. The two-kind discriminator is the steady state until a future consumer earns a third; close-out promotion should confirm this and leave the discriminator extensible (`output: { template } | { factory }` admits additional arms without changing the descriptor's tagged-union shape).
- **`ctx` parameter on the factory — pinned.** M3.5 R1 shipped factory signature `(input) => IRNode` without an explicit `ctx` parameter — the in-tree exemplars (enum, namespace) construct IR-class instances directly from validated input, and the factory captures any family/target context it needs through the contributing pack's closure. Close-out promotion folds this into the Decision § text. If a future consumer earns a `ctx` parameter, the signature widens additively.
- **Backport timing for `field` and `type`.** [TML-2513](https://linear.app/prisma-company/issue/TML-2513) tracks backporting the descriptor + factory output dispatch to the existing `field` and `type` namespaces so all three dispatch identically. The backport is mechanical and is not blocking this ADR's promotion. Close-out promotion keeps this ADR scoped to `entities`; TML-2513 ships its own ADR appendix (or amends this one) when it lands.
- **Template-shaped `entities` contributions.** M4's enum and M5a's namespace exemplars are both factory-shaped (IR-class instance output). If no in-tree `entities` contribution ever uses template output, the "templates are the lowest common denominator" framing is shape-uniformity with `field` / `type` rather than a load-bearing path for this namespace. Close-out promotion should either find a template-shaped exemplar or document that `entities` contributions are factory-shaped by nature and the template branch exists for shape-uniformity.
- **Naming and ADR number.** This ADR is drafted as "target-extensible authoring". Candidates for the permanent name: "Pack-contributed entity types and the authoring contribution shape" (descriptive but long), "Target-extensible authoring via pack contributions" (closer to the title but less specific), "AuthoringContributions: the entityTypes namespace + registry-driven hydration" (technical but precise). The permanent name should be picked at close-out alongside the companion ADRs so the trio reads as a coherent set.
- **Discriminator-as-static-on-IR-class alternative.** The descriptor's `discriminator: string` field is the explicit form. An alternative reads the discriminator from the IR class's static `kind` field (e.g. `PostgresEnumType.kind = 'sql-enum-type' as const`) via the descriptor's factory closure — fewer parallel sources of truth (the IR class instance's runtime `kind` and the descriptor's static `discriminator` already need to agree). Rejected for M7 because it requires every IR class targeting the registry to carry a static `kind` field plus the descriptor to declare which IR class it constructs (`irClass: typeof PostgresEnumType`); the explicit-on-descriptor form is one field, no extra type plumbing, and makes the discriminator explicit at the contribution site (where extension authors think about it). Close-out promotion may revisit if a future consumer earns the static-on-class shape.
