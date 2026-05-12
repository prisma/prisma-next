# ADR (draft) — 3-layer polymorphic IR convention

> **Status:** Draft (lives under `projects/target-extensible-ir/specs/` while the project executes; promoted to `docs/architecture docs/adrs/` with a permanent ADR number at close-out per the M6 plan task).
>
> **Project:** [target-extensible IR (TML-2459)](../spec.md). Refined throughout M2–M5b as the convention is exercised against a second family (Mongo, M2), the SQL targets (M3), enums (M4), and the namespace exemplar (M5a/b).

## At a glance

Both Contract IR and Schema IR are organised as polymorphic class hierarchies in three layers:

1. **Framework** (`packages/1-framework/...`): defines the IR alphabet (`SchemaNode`, `Namespace`, `Storage`) and the SPI interfaces consumers depend on (`ContractSerializer<TContract>`, `SchemaVerifier<TContract, TSchema>`). Carries the `SchemaNodeBase` and `NamespaceBase` abstract classes that centralise the freeze-and-assign pattern every concrete IR node uses.
2. **Family** (`packages/2-sql/...`, `packages/2-mongo-family/...`): ships abstract base classes for the family-shape vocabulary (`SqlTable`, `SqlColumn`, `SqlForeignKey`, …; `MongoSchemaNode` and the Mongo collection bases). Per SPI, ships an abstract base (`SqlContractSerializerBase`, `MongoSchemaVerifierBase`, …) carrying family-shared walk logic and exposing protected hooks for target extensions.
3. **Target** (`packages/3-targets/...`, `packages/3-mongo-target/...`): ships concrete classes specialising the family abstract bases (`PostgresTable extends SqlTable` carrying `nativeType` and default-rendering; `SqliteIndex extends SqlIndex` carrying SQLite's `WHERE` shape) **plus target-only kinds with no family parent** (`PostgresFunction`, future `PostgresRlsPolicy`, `MongoChangeStream`). Owns the verifier, planner, introspector — they walk the target's concrete classes natively.

Aggregation lives on the existing target descriptor (`SqlControlTargetDescriptor`, the Mongo target descriptor, …), which grows new typed properties (`contractSerializer`, `schemaVerifier`) next to the existing `migrations` capability. **There is no separate `Target<TContract, TSchema>` aggregator interface.** The descriptor IS the aggregator.

## Context

Contract IR and Schema IR were originally flat data shapes (`type SqlStorage = …`, `type SqlSchemaIR = …`). Adding target-specific kinds (Postgres functions, the upcoming Supabase RLS work, future Postgres-only foreign-data wrappers) demanded extending those flat shapes from outside their owning packages, which the type system actively resists — additive widening of a `Record<string, …>` map at one site forces every consumer to widen the same way, and target-specific fields end up being shoehorned into framework-shaped `meta` blobs.

The architectural ask the project landed on:

- IR should be **polymorphic** — concrete target classes carry target-specific fields and methods directly; consumers dispatch on `kind` discriminants and `instanceof` checks rather than reaching through `meta` blobs.
- IR should be **layered** so the framework can promise the alphabet, the family can centralise shared structural commitments, and the target can extend without touching either.
- IR should remain **JSON-canonical on disk**: in-memory IR round-trips through `JSON.stringify` / a typed deserializer without ceremony. Class fields are plain readonly properties; no `toJSON()` methods, no `Map`/`Set`/`Date` instances.

Two pre-existing exemplars proved the pattern in narrow domains:

- `OpFactoryCall` (planner IR with two renderers) — a discriminated union of frozen AST classes with a visitor for exhaustive dispatch ([ADR 195](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)).
- `MongoSchemaNode` AST (Mongo schema IR alphabet) — abstract base + concrete kind classes with `accept` for visitor dispatch.

This ADR generalises those patterns to all IR in the codebase and codifies the framework/family/target split.

## Decision

### Framework layer

- `interface SchemaNode { readonly kind: string }` — the bare alphabet. Every concrete IR node, whatever its family or target, satisfies this.
- `abstract class SchemaNodeBase implements SchemaNode` — centralises `protected freeze()`. Subclasses call `this.freeze()` in their constructors after assigning their fields.
- `interface Namespace extends SchemaNode { readonly id: string }` — first-class building block. Sentinel id `'__unspecified__'` reserved for connection-bound binding (resolved by per-target singleton subclasses, not by call-site branches).
- `abstract class NamespaceBase implements Namespace` — convenience base for target Namespace concretions.
- `interface Storage { readonly namespaces: Record<string, Namespace> }` — every IR carries namespaces. Type-level enforcement of "every storage object belongs to a namespace" (FR15).
- `interface ContractSerializer<TContract> { deserializeContract(json): TContract; serializeContract(contract): JsonObject }` — the JSON ⇄ class boundary. Both directions live on the same SPI because the framework needs both faces today (round-trip property tests, drift detection, future canonicalization).
- `interface SchemaVerifier<TContract, TSchema> { verifySchema({contract, schema}): SchemaVerifyResult }` — per-target verifier; the framework wraps results into the existing `VerifyDatabaseSchemaResult` envelope.

### Family layer

- IR alphabet: `abstract class SqlNode extends SchemaNodeBase`, `abstract class MongoSchemaNode extends SchemaNodeBase`. Concrete IR-node bases (`SqlTable`, `SqlColumn`, `SqlForeignKey`, `SqlIndex`, `SqlPrimaryKey`, `SqlUnique`, `SqlStorage`) commit to the family-shape contract but defer field richness to the target layer.
- SPI bases: per-SPI single-inheritance abstract classes (`SqlContractSerializerBase`, `SqlSchemaVerifierBase`, `MongoContractSerializerBase`, `MongoSchemaVerifierBase`). Default `serializeContract` is identity over JSON-clean class instances; `deserializeContract` calls a protected `parseFamilyContractStructure` hook + a protected `constructTargetContract` hook. `verifySchema` runs `verifyCommonFamilySchema` + `verifyTargetExtensions` and combines the issues.

### Target layer

- IR-node concretions extend the family abstract bases (`PostgresTable extends SqlTable`, `MongoTargetCollection extends MongoCollection`).
- Target-only kinds extend `SchemaNodeBase` directly when no family parent fits (`PostgresRlsPolicy`, `PostgresFunction`).
- SPI implementers extend the family SPI base (`PostgresContractSerializer extends SqlContractSerializerBase<PostgresContract>`, `MongoTargetSchemaVerifier extends MongoSchemaVerifierBase`).
- The existing target descriptor (`postgresControlTargetDescriptor`, Mongo target descriptor) composes the implementer instances as named properties next to the existing `migrations` property.

### Aggregation lives on the existing descriptor

The `*ControlTargetDescriptor` types (and runtime equivalents) grow two new named properties: `contractSerializer` and `schemaVerifier`. Future SPIs add one new descriptor property each. **No new `Target<TContract, TSchema>` interface is introduced** — the descriptor pattern that already aggregates the control-plane SPIs (planner, runner, schema mapper) is the seam new SPIs slot into. Framework consumers depend on the framework SPI interfaces (`ContractSerializer<TContract>`, `SchemaVerifier<TContract, TSchema>`); they reach a target's SPI through the descriptor (`descriptor.contractSerializer`).

### `__unspecified__` is a target-specific singleton subclass

Each target owning a `Namespace` concretion ships a singleton subclass (`PostgresUnspecifiedSchema extends PostgresSchema`, `MongoTargetUnspecifiedDatabase extends MongoTargetDatabase`) with `readonly id = '__unspecified__' as const`. The subclass overrides the namespace's qualifier-emission methods to elide the prefix. Call sites stay polymorphic — there are **no `if (namespace.id === '__unspecified__')` branches anywhere in the codebase**. The framework's promise is one stable static reference per target (`PostgresSchema.unspecified`).

### JSON canonical on disk; classes canonical in-memory

Per [ADR 192](../../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) (which the project spec extends from migration ops to Contract IR / Schema IR), the on-disk JSON form is the canonical artifact. The in-memory IR is a class hierarchy that round-trips through JSON without ceremony: class fields are JSON-clean by construction (plain readonly properties, kind discriminant, no methods on properties, no `Map`/`Set`, no `Date`); `JSON.stringify(contract)` produces canonical contract.json directly. The `ContractSerializer` SPI handles the typed inverse direction.

The standalone `validateContract(json)` function is removed; framework-internal hydration call sites become `descriptor.contractSerializer.deserializeContract(json)`. The user-facing facade (`postgres<Contract>(...)`) wraps this so end-users never see the SPI.

### Visitor pattern stays narrow

Visitors are reserved for narrow structural ops (`MongoSchemaVisitor`, `OpFactoryCall.accept`). General IR walks dispatch on `kind` discriminants directly; visitors are not the default polymorphism shape because they multiply at every kind addition. See § "Visitor pattern reserved for narrow structural ops" in the project spec.

## Consequences

### What this enables

- **Target extensibility without framework or family edits.** Postgres adds an `RlsPolicy` IR node by extending `SchemaNodeBase` directly, registers it in `PostgresStorage`, and the verifier walks it natively. The framework never needs to know an RLS policy exists; the family never needs to know.
- **Type-safe target-specific fields.** `PostgresColumn.nativeType` is a real field on a real class, not a `meta.nativeType` blob fished out at runtime. Consumers that have a `PostgresColumn` in hand reach `nativeType` directly.
- **One-line specialisation for descendant targets.** Cockroach extends Postgres by `class CockroachContractSerializer extends PostgresContractSerializer { protected constructTargetContract(...) { ... } }` and injecting the override into the Cockroach descriptor — no need to absorb the rest of the Postgres-target surface.
- **Cross-target consistency.** A reader who follows the SQL-Postgres column reads the Mongo collection the same way: framework alphabet → family abstract → target concretion. The convention IS the cross-target consistency promise the architectural principles encode (FR23).

### What this costs

- **Constructor-time freeze.** Every concrete IR-node class calls `this.freeze()` in its constructor. The boilerplate is one line, codified by `SchemaNodeBase`.
- **Three-layer cognitive cost.** A reader who wants to know what a `PostgresColumn` looks like reads three files: `SchemaNodeBase`, `SqlColumn`, `PostgresColumn`. The cost buys the layered extension story; the cost is paid once per kind, not per consumer.
- **JSON-canonical discipline.** Class fields must remain plain readonly properties (no `Map`, no `Set`, no `Date`, no methods on properties). The `ContractSerializer` round-trip property test attests this on every CI run; violations are caught at PR review or by the round-trip test, not at runtime.

### What this rules out

- **No flat-data IR.** `type SqlStorage = …` (flat) does not coexist with `class SqlStorage` (polymorphic) in the consumer surface. M3 deletes the flat-data SQL Contract IR; M2 deletes the flat-data Mongo Contract IR. Anything that reaches for the old flat shape after that fails to compile.
- **No `accept` method on every node.** The visitor pattern is reserved for narrow structural ops where a single visitor can exhaustively cover the dispatch (`MongoSchemaVisitor`, `OpFactoryCall.accept`). General consumers dispatch on `kind` directly. `SchemaNode` does **not** declare `accept`; family bases do not bake it in.
- **No new aggregator interface.** `Target<TContract, TSchema>` is not a thing. The descriptor IS the aggregator; the framework consumes SPI references via `descriptor.contractSerializer`, `descriptor.schemaVerifier`, etc.

## Alternatives considered

- **Generic data shapes with target-specific extension blobs (`meta` records).** Today's flat-data approach. Rejected: extension blobs lose static types, force consumers to runtime-narrow at every reach, and concentrate target awareness in framework code rather than in the target. The Supabase RLS exploration that motivated this project ran headlong into this — every framework-side reach for an RLS-related field needed an `if (target === 'supabase')` branch that defeated the architecture.
- **Generic IR + per-target adapter classes.** Keep the IR generic; ship a target-specific adapter that knows how to read the target-specific fields. Rejected: this adds a layer of indirection without removing the source of pain — the target-specific fields still aren't typed at the IR level, and adapter logic ends up duplicating the IR's structural walk.
- **A `Target<TContract, TSchema>` aggregator interface.** Earlier draft of the spec proposed this. Rejected during shaping: the existing target descriptor (`SqlControlTargetDescriptor` and the Mongo equivalent) already aggregates the control-plane SPIs via `migrations`. Adding a parallel aggregator would create two seams where one is honest. The descriptor pattern is the seam; new SPIs slot in next to `migrations`.
- **Visitor at every layer.** Rejected for the reasons in [ADR 195](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md): visitors multiply at every new kind, force every consumer to handle every kind exhaustively even when only a few matter, and obscure the simple `kind`-discriminant dispatch most call sites want.

## Open questions (for the close-out promotion)

- **`SchemaIssue` layering.** The framework `SchemaIssue` union (in `framework-components/control/control-result-types.ts`) is SQL-flavoured by content but framework-level by package. This project keeps it as-is (target-specific issue kinds widen target-side); the close-out should either resolve the layering or document the decision to keep it as a forward concern. The follow-up Supabase project (RLS as an IR kind) is the natural place to revisit.
- **Schema IR persistence.** Today's Schema IR is hydrated from introspection and discarded; if a future project persists `schema.json`, the canonical-JSON contract this ADR describes for Contract IR applies symmetrically.
- **Per-family enums (M4).** The enum exemplar lands in M4 to validate the convention against a structural refactor; the ADR's wording of "family abstract base for IR nodes" should be sharpened against what M4 actually ships.
- **Cross-namespace FK shape (M5b).** The FK reference IR carries a `(namespace.id, name)` coordinate, but the exact field shape is decided in M5b. The ADR's "FK references carry a namespace coordinate on both sides" wording should be sharpened against what M5b actually ships.
