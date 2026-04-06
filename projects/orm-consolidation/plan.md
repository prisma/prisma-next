# ORM Consolidation — Execution Plan

## Summary

Consolidate the SQL and Mongo ORM clients onto a shared `Collection` interface with fluent chaining, following [ADR 175](../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md). Phase 1 builds a Mongo `Collection` independently (spike). Phase 1.5 adds write operations. Phase 1.75 adds polymorphism and embedded documents to both families — the features where SQL and Mongo diverge most in query compilation. Phase 2 extracts the shared interface from two concrete implementations that are feature-complete enough to reveal the real divergence points. Success means Mongo users get the same chaining API as SQL, custom collection subclasses work across both families, polymorphic queries work through the shared interface, and a shared `Collection` base class lives in the framework layer.

**Spec:** [projects/orm-consolidation/spec.md](spec.md)

**Linear:** [TML-2189](https://linear.app/prisma-company/issue/TML-2189) — project [WS4: MongoDB & Cross-Family Architecture](https://linear.app/prisma-company/project/ws4-mongodb-and-cross-family-architecture-89d4dcdbcd9a)

## Collaborators

| Role         | Person | Context                                              |
| ------------ | ------ | ---------------------------------------------------- |
| Maker        | Will   | Drives execution                                     |
| Collaborator | Alexey | SQL ORM owner — Phase 2 changes SQL Collection       |

## Phases

### Phase 1: Mongo Collection spike (isolated)

Build `MongoCollection` with the same fluent chaining API as SQL, compiling to `MongoReadPlan` (typed pipeline AST) at terminal methods. No changes to the SQL ORM or framework layer.

**Detailed plan:** [plans/phase-1-mongo-collection-spike.md](plans/phase-1-mongo-collection-spike.md)

**Milestones:**

1. Query AST (`@prisma-next/mongo-query-ast`) — filter expressions, read stages, visitors, lowering, extension operator proof
2. ORM Collection with chaining + compilation (CollectionState → MongoReadPlan)
3. Wire `mongoOrm()` + update demo + integration tests

**Proof:** Mongo demo uses `.where().select().include().orderBy().take().all()` chaining, executing against `mongodb-memory-server`.

### Phase 1.5: Mongo write operations

**Linear:** [TML-2194](https://linear.app/prisma-company/issue/TML-2194)

**Detailed plan:** [plans/phase-1.5-write-operations.md](plans/phase-1.5-write-operations.md)

Phase 1 is read-only. The SQL ORM already has `create()`, `createAll()`, `createCount()`, `update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`, and `upsert()`. We can't extract a meaningful shared `Collection` interface until the Mongo ORM covers the same surface area — otherwise we'd extract only the read portion and have to refactor the base class again when writes land.

**Milestones:**

1. Command types + driver + adapter — add `InsertManyCommand`, `UpdateManyCommand`, `DeleteManyCommand`, `FindOneAndUpdateCommand`, `FindOneAndDeleteCommand` as `MongoAstNode` subclasses in `mongo-query-ast` (filter fields accept `MongoFilterExpr`), with wire commands in `mongo-core`, result types, adapter lowering (via `lowerFilter()`), and driver execution
2. ORM write methods — add `create`, `createAll`, `createCount`, `update`, `updateAll`, `updateCount`, `delete`, `deleteAll`, `deleteCount`, `upsert` to `MongoCollection`
3. Demo + integration tests — replace raw `MongoClient` seeding with ORM writes, full CRUD lifecycle tests
4. Dot-path field accessor mutations ([ADR 180](../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)) — add targeted mutation operators (`set`, `inc`, `push`, etc.) via the callable string accessor `u("field.path")`. Maps to MongoDB's native `$set`/`$inc`/`$push` with dot-notation. Depends on value objects landing in the contract ([ADR 178](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)); can be sequenced after milestones 1–3 or deferred to the value objects project.
5. Unified query plan — introduce `MongoQueryPlan` in `mongo-query-ast`, collapse the bifurcated `execute`/`executeCommand` into a single `execute(plan)` at the executor, runtime, and adapter layers. This must ship with Phase 1.5 to avoid propagating the dual interface into Phase 2's shared Collection extraction. See [design doc](plans/unified-mongo-query-plan.md).

**Proof:** Mongo demo seeds data via ORM write methods. Integration tests verify create/update/delete round-trip against `mongodb-memory-server`.

### Phase 1.6: Codec-owned value serialization

**Linear:** [TML-2202](https://linear.app/prisma-company/issue/TML-2202)

Implement [ADR 184](../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md) — extend the core `Codec` interface with `encodeJson`/`decodeJson` methods so codecs own the contract JSON serialization boundary for their types. Replace the hardcoded bigint/Date branches (`encodeDefaultLiteralValue`, `bigintJsonReplacer`, `decodeContractDefaults`, `DefaultLiteralValue<>`) with codec dispatch. This is a prerequisite for Phase 1.75: the emitter needs to serialize discriminator values into `contract.json`, and the runtime needs to decode them — both via the discriminator field's codec.

**Scope:**

1. **Core codec interface** — add optional `encodeJson`/`decodeJson` to the `Codec` interface. Codecs for JSON-safe types omit them (passthrough). Implement on `pg/int8@1` (bigint) and `pg/timestamp@1`/`pg/date@1` (Date) to replace the existing hardcoded branches.
2. **Emission** — replace `encodeDefaultLiteralValue` and `bigintJsonReplacer` with `codec.encodeJson()` dispatch.
3. **Validation/loading** — replace `decodeContractDefaults` with `codec.decodeJson()` dispatch.
4. **Type generation** — simplify `DefaultLiteralValue<>` conditional type; the codec type map already knows the output type.
5. **DDL and PSL interfaces** — the `DdlLiteralCodec` and `PslLiteralCodec` interfaces can land incrementally with migration work and authoring work respectively; they are not required for Phase 1.75.

**Proof:** Existing column default tests pass with codec dispatch instead of hardcoded branches. A non-JSON-safe type (bigint) round-trips through `contract.json` via codec methods. No `$type` tags in newly emitted contracts.

### Phase 1.75: Polymorphism, embedded documents, and value objects (both families)

**Linear:** [TML-2203](https://linear.app/prisma-company/issue/TML-2203)

Neither ORM currently has end-to-end polymorphism, embedded document, or value object support — the Mongo ORM has type-level machinery (`InferRootRow`/`VariantRow`, `InferFullRow`/`EmbedRelationKeys`) from the PoC, but no authoring path produces contracts with these features, and the SQL ORM has no polymorphism implementation at all. The contract schema has structural slots for `discriminator`, `variants`, `base`, `owner`, and `valueObjects`, but they are exercised only by hand-crafted test fixtures.

The same reasoning that motivated Phase 1.5 applies here: we can't extract a meaningful shared `Collection` interface until both implementations cover polymorphism and embedded documents. These are the features where the two families diverge most in query compilation (Mongo: single collection + discriminator `$match`; SQL: STI single table or MTI JOINs). Extracting the shared interface without them would produce a lowest-common-denominator base that works only for flat models — exactly the "predict from one" anti-pattern ADR 175 warns against. Both concrete implementations need polymorphism before extraction can discover the real interface design questions.

This phase also includes value objects ([ADR 178](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)) and simplification of the typed JSON column machinery. Value objects and embedded documents share the same ORM infrastructure (inlined in results, nested input types, dot-path filtering) and are best implemented together. The existing typed JSON column pipeline (`typeParams.schemaJson`, phantom `typeParams.schema`, `parameterizedRenderers`) is replaced with codec-dispatched type rendering — the same codec-dispatch pattern as ADR 184.

**Spec:** [specs/embedded-documents-and-value-objects.spec.md](specs/embedded-documents-and-value-objects.spec.md)

**Scope:**

1. **Value object field type system** — extend `many: true` to scalar fields (scalar arrays), add `dict: true` modifier (string-keyed maps). Contract validation for value object references and field descriptor combinations.
2. **Contract authoring** — PSL interpreter and emitter support for `discriminator`/`variants`/`base` (polymorphism), `owner` with embed relations (embedded documents), and `valueObjects` definitions with field references. Both families can emit contracts that exercise these features.
3. **Typed JSON simplification** — replace `parameterizedRenderers` with codec-dispatched `renderType` method. Remove phantom `typeParams.schema`. The `pg/jsonb@1` codec owns its TypeScript type rendering via the same dispatch-by-`codecId` pattern as `encodeJson`/`decodeJson`.
4. **Mongo ORM** — end-to-end polymorphism: discriminator filter injection in read queries, variant-aware writes (auto-inject discriminator value on `create()`), discriminated union return types. Value objects and embedded documents: inlined in results, dot-path filtering via MongoDB native dot notation, nested create/update input types.
5. **SQL ORM** — STI polymorphism at minimum: discriminator `WHERE` filter, variant return types with discriminated unions, variant-aware writes. Value objects: inlined from JSONB columns, dot-path filtering via JSONB path operators. Coordinate with Alexey.
6. **Tests** — both families tested against real databases with polymorphic, embedded-document, and value-object contracts.

**Proof:** Querying a polymorphic root returns a discriminated union type that narrows correctly on the discriminator field in both SQL and Mongo ORM clients, using contracts produced by the emitter (not hand-crafted fixtures). A model with a value object field produces a correctly nested TypeScript row type; dot-path filtering on the value object field compiles to the correct target-specific query in both families.

### Phase 2: Shared interface extraction (coordinate with Alexey)

Extract `Collection<C, M>` base class, `CollectionState`, `InferModelRow`, and include interface from the two concrete implementations into the framework layer. Both SQL and Mongo now have complete read + write + polymorphism surfaces to compare.

**Detailed plan:** [plans/phase-2-shared-interface-extraction.md](plans/phase-2-shared-interface-extraction.md)

**Milestones:**

1. Extract `CollectionState` and chaining base
2. Extract `InferModelRow` utility type
3. Extract shared include interface
4. Extract shared mutation interface (`create`, `update`, `delete`)
5. Extract shared polymorphism interface (discriminator filtering, variant return types)
6. Verify custom collection subclasses
7. Client shape extraction

**Proof:** Both SQL and Mongo Collections extend a shared base class. Custom collection subclasses work identically for both families. Polymorphic queries work through the shared interface in both families. All existing tests pass.

## Dependencies

- **No dependency on M5 (unified contract) or M6 (SQL emitter migration)** from the contract domain extraction project — the ORM query surface is independent.
- **Phase 1.5 depends on Phase 1** — write operations build on the collection class and adapter interface established in Phase 1.
- **Phase 1.6 depends on Phase 1.5** — codec interface changes touch the same contract loading and emission code; Phase 1.5 should land first to avoid conflicts.
- **Phase 1.75 depends on Phase 1.6** — polymorphism requires codec-owned value serialization to encode/decode discriminator values in the contract. Also depends on Phase 1.5 for write operations (variant-aware creates/updates).
- **Phase 1.75 requires coordination with Alexey** — SQL STI polymorphism touches the SQL ORM client.
- **Phase 2 depends on Phase 1.75** — can't extract a meaningful shared interface until both implementations cover reads, writes, polymorphism, and embedded documents. Extracting without these features would miss the divergence points between families.
- **Phase 2 requires coordination with Alexey** — extraction changes the SQL Collection's inheritance hierarchy.

## Follow-ups

### ~~Remove legacy command types from mongo-core~~ (done)

Resolved during Phase 1.5. Legacy `FindCommand`, `MongoQueryPlan`, and the adapter's `lower()` method were deleted in Phase 1. In Phase 1.5, write command classes (`InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, plus new `InsertManyCommand`, `UpdateManyCommand`, `DeleteManyCommand`, `FindOneAndUpdateCommand`, `FindOneAndDeleteCommand`) were moved from `mongo-core` to `@prisma-next/mongo-query-ast` as proper AST nodes (extending `MongoAstNode`). Command filter fields now accept `MongoFilterExpr` (typed AST) instead of pre-lowered `MongoExpr` documents. A structural `MongoCommandLike` interface in `mongo-core` allows the adapter to reference commands without a direct dependency on `mongo-query-ast`. The adapter is the sole component that performs filter lowering (converting `MongoFilterExpr` to wire-level filter documents). Wire commands remain in `mongo-core` as they represent the driver-facing wire protocol.

### Mongo family layering reorganization

**Linear:** [TML-2201](https://linear.app/prisma-company/issue/TML-2201/mongo-family-layering-reorganization)

The current Mongo family has two related structural problems:

1. **Over-burdened `1-core`**: contains contract types, codecs, values, wire commands, adapter/driver interfaces, and result types — responsibilities that belong at different layers.
2. **Adapter interface placement**: the adapter interface sits in `1-core` (layer 1) but needs to reference AST types from `2-query` (layer 2). This forces structural shim types (`MongoCommandLike`, `MongoReadPlanLike`) that exist solely to work around the layering constraint.

The target design introduces 8 layers: `foundation` (split into `mongo-contract`, `mongo-codec`, `mongo-value`), `authoring`, `tooling`, `query`, `query-builders`, `transport` (adapter/driver interfaces + wire types), `runtime`, and `family`. Wire commands and adapter/driver interfaces move out of foundation into the transport layer, where they can reference AST types directly. Structural shims are eliminated.

This is a separate refactor from the unified query plan (Phase 1.5 milestone 5). The unified query plan fixes the API shape (single execute, single lower); the layering reorganization fixes where those interfaces live.

**Design:** [plans/mongo-family-layering.md](plans/mongo-family-layering.md)

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/orm-consolidation/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/orm-consolidation/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/orm-consolidation/`
