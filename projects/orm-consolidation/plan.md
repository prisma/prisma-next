# ORM Consolidation — Execution Plan

## Summary

Consolidate the SQL and Mongo ORM clients onto a shared `Collection` interface with fluent chaining, following [ADR 175](../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md). Phase 1 builds a Mongo `Collection` independently (spike). Phase 1.5 adds write operations. Phase 1.75 adds polymorphism, value objects, and embedded documents to both families — the features where SQL and Mongo diverge most in query compilation — split into three independent workstreams (typed JSON simplification, polymorphism, value objects & embedded docs). Phase 2 extracts the shared interface from two concrete implementations that are feature-complete enough to reveal the real divergence points. Success means Mongo users get the same chaining API as SQL, custom collection subclasses work across both families, polymorphic queries work through the shared interface, and a shared `Collection` base class lives in the framework layer.

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

Implement [ADR 184](../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md) — add required `encodeJson`/`decodeJson` methods to a common `Codec` base interface at the framework layer, so codecs own the contract JSON serialization boundary for their types. Replace the hardcoded bigint/Date branches (`encodeDefaultLiteralValue`, `bigintJsonReplacer`, `decodeContractDefaults`, `DefaultLiteralValue<>`) with codec dispatch. This is a prerequisite for Phase 1.75: the emitter needs to serialize discriminator values into `contract.json`, and the runtime needs to decode them — both via the discriminator field's codec.

**Scope:**

1. **Framework codec base interface** — extract the common codec shape (`id`, `targetTypes`, `traits`, `encode`, `decode`) from SQL's `Codec` and Mongo's `MongoCodec` into a base `Codec` interface at the framework layer. Add required `encodeJson`/`decodeJson` methods. The `codec()` factory provides identity defaults for JSON-safe types. SQL's codec extends the base with SQL-specific fields (`meta`, `paramsSchema`, `init`). Mongo's codec becomes a type alias or thin extension.
2. **Concrete codec implementations** — implement `encodeJson`/`decodeJson` on `pg/timestamptz@1` and `pg/timestamp@1` (Date ↔ ISO string). `pg/int8@1` stays `number` (identity). All other existing codecs get identity defaults via the factory.
3. **Emission** — extend `EmitStackInput` with codec registry access. Replace `encodeDefaultLiteralValue` and `bigintJsonReplacer` with `codec.encodeJson()` dispatch.
4. **Contract loading** — integrate codec decoding into the `validateContract` pipeline (codec registry flows in alongside storage validator). Replace `decodeContractDefaults` with `codec.decodeJson()` dispatch.
5. **Type generation** — simplify `DefaultLiteralValue<>` to derive the decoded type from `CodecTypes`. For the emit workflow, the emitter can resolve the concrete type per column (including parameterized types). For the no-emit workflow, a type-level mechanism maps through `CodecTypes`. Both paths must handle parameterized types where the output type depends on type parameters.
6. **Cleanup** — remove `TaggedBigInt`, `TaggedRaw`, `TaggedLiteralValue`, `bigintJsonReplacer`, `isTaggedBigInt`, `isTaggedRaw`, and the `$type` collision guard infrastructure.
7. **DDL and PSL interfaces** — the `DdlLiteralCodec` and `PslLiteralCodec` interfaces can land incrementally with migration work and authoring work respectively; they are not required for Phase 1.75.

**Proof:** Existing column default tests pass with codec dispatch instead of hardcoded branches. A non-JSON-safe type (Date) round-trips through `contract.json` via codec methods. No `$type` tags in newly emitted contracts.

### Phase 1.75: Polymorphism, embedded documents, and value objects (both families)

Neither ORM currently has end-to-end polymorphism, embedded document, or value object support — the Mongo ORM has type-level machinery (`InferRootRow`/`VariantRow`, `InferFullRow`/`EmbedRelationKeys`) from the PoC, but no authoring path produces contracts with these features, and the SQL ORM has no polymorphism implementation at all. The contract schema has structural slots for `discriminator`, `variants`, `base`, `owner`, and `valueObjects`, but they are exercised only by hand-crafted test fixtures.

The same reasoning that motivated Phase 1.5 applies here: we can't extract a meaningful shared `Collection` interface until both implementations cover polymorphism and embedded documents. These are the features where the two families diverge most in query compilation (Mongo: single collection + discriminator `$match`; SQL: STI single table or MTI JOINs). Extracting the shared interface without them would produce a lowest-common-denominator base that works only for flat models — exactly the "predict from one" anti-pattern ADR 175 warns against. Both concrete implementations need polymorphism before extraction can discover the real interface design questions.

This phase is split into three independent workstreams:

#### Phase 1.75a: Typed JSON simplification

**Linear:** [TML-2204](https://linear.app/prisma-company/issue/TML-2204)

Replace the bespoke `parameterizedRenderers` / phantom `typeParams.schema` pipeline with codec-dispatched `renderType`. The `pg/jsonb@1` codec owns its TypeScript type rendering via a dispatch-by-`codecId` pattern — the same architectural pattern as `encodeJson`/`decodeJson` from Phase 1.6, applied to type generation. This is infrastructure that value objects (Phase 1.75c) build on.

**Scope:**

1. **Codec-owned TypeScript type rendering** — replace the `parameterizedRenderers` map with a codec-level type rendering interface, dispatched by `codecId`. Codecs without `renderType` fall back to `CodecTypes[codecId]['output']`.
2. **Remove phantom `typeParams.schema`** — type rendering driven by `typeParams.schemaJson` through the codec's `renderType` method.
3. **Untyped JSON columns** — `jsonb()` with no schema continues to produce `JsonValue`.

**Proof:** Existing typed JSON column tests pass with codec-dispatch infrastructure. `jsonb()` and `jsonb(schema)` both produce correct types.

#### Phase 1.75b: Polymorphism (both families)

**Linear:** [TML-2205](https://linear.app/prisma-company/issue/TML-2205)

End-to-end polymorphism in both SQL and Mongo ORM clients. This is the critical path for Phase 2 — polymorphism is where the two families diverge most in query compilation.

**Scope:**

1. **Contract authoring** — PSL interpreter and emitter support for `discriminator`/`variants`/`base`. Both families can emit contracts that exercise polymorphism.
2. **Mongo ORM** — discriminator filter injection in read queries, variant-aware writes (auto-inject discriminator value on `create()`), discriminated union return types.
3. **SQL ORM** — STI polymorphism at minimum: discriminator `WHERE` filter, variant return types with discriminated unions, variant-aware writes. Coordinate with Alexey.
4. **Tests** — both families tested against real databases with polymorphic contracts.

**Proof:** Querying a polymorphic root returns a discriminated union type that narrows correctly on the discriminator field in both SQL and Mongo ORM clients, using contracts produced by the emitter (not hand-crafted fixtures).

#### Phase 1.75c: Value objects & embedded documents (both families)

**Linear:** [TML-2206](https://linear.app/prisma-company/issue/TML-2206)

**Spec:** [specs/embedded-documents-and-value-objects.spec.md](specs/embedded-documents-and-value-objects.spec.md)

End-to-end value objects and embedded documents. Value objects and embedded documents share the same ORM infrastructure (inlined in results, nested input types, dot-path filtering) and are best implemented together.

**Scope:**

1. **Value object field type system** — extend `many: true` to scalar fields (scalar arrays), add `dict: true` modifier (string-keyed maps). Contract validation for value object references and field descriptor combinations.
2. **Contract authoring** — PSL interpreter and emitter support for `valueObjects` definitions with field references, and `owner` with embed relations (embedded documents).
3. **Mongo ORM** — value objects and embedded documents: inlined in results, dot-path filtering via MongoDB native dot notation, nested create/update input types.
4. **SQL ORM** — value objects: inlined from JSONB columns, dot-path filtering via JSONB path operators. Coordinate with Alexey.
5. **Tests** — both families tested against real databases with value-object and embedded-document contracts.

**Proof:** A model with a value object field produces a correctly nested TypeScript row type; dot-path filtering on the value object field compiles to the correct target-specific query in both families.

### Phase 2: Shared interface extraction (coordinate with Alexey)

**Linear:** [TML-2213](https://linear.app/prisma-company/issue/TML-2213)

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
- **Phase 1.75a (typed JSON simplification)** — independent; no blockers beyond Phase 1.5 landing first.
- **Phase 1.75b (polymorphism) depends on Phase 1.6** — discriminator values are encoded/decoded through the discriminator field's codec. Also depends on Phase 1.5 for write operations (variant-aware creates/updates). Requires coordination with Alexey for SQL STI.
- **Phase 1.75c (value objects) depends on Phase 1.75a** — value object type rendering in the emitter uses the codec-dispatch infrastructure from the typed JSON simplification. Also depends on Phase 1.5 for nested create/update.
- **Phase 1.75a and 1.75b are independent** — they can run in parallel.
- **Phase 2 depends on all three Phase 1.75 workstreams** — can't extract a meaningful shared interface until both implementations cover reads, writes, polymorphism, and embedded documents. Extracting without these features would miss the divergence points between families.
- **Phase 2 requires coordination with Alexey** — extraction changes the SQL Collection's inheritance hierarchy.

### Phase 2.5: Mongo aggregation pipeline builder

**Linear:** [TML-2207](https://linear.app/prisma-company/issue/TML-2207)

**Design docs:** [Aggregation expression AST](plans/aggregation-expression-ast-design.md), [Pipeline AST completeness](plans/pipeline-ast-completeness-design.md), [Pipeline builder](plans/pipeline-builder-design.md)

A type-safe, contract-aware aggregation pipeline builder for MongoDB — the lower-level escape hatch for queries the ORM can't express, equivalent to the SQL query builder (`sql().from(...).select(...)`). Also introduces pipeline-style updates (computed writes using aggregation expressions).

**Milestones:**

1. **Raw pipeline API** — User-facing `db.rawPipeline(collection, stages)` for executing plain MongoDB pipeline stage documents. No type inference (user asserts the return type), but validates the full execution path end-to-end. This is the first vertical slice — it ships before any AST work and gives users an immediate escape hatch for any aggregation.

2. **Aggregation expression AST** — Typed representation of MongoDB aggregation expressions (`MongoAggExpr` union) in `@prisma-next/mongo-query-ast`. Class hierarchy with `kind` discriminant, `accept()`/`rewrite()`, visitor/rewriter interfaces, and lowering. These expressions are shared infrastructure for both read pipelines and pipeline-style updates (computed writes).

3. **Pipeline AST completeness** — Extend the stage AST to cover the complete MongoDB aggregation pipeline, eliminating `Record<string, unknown>` from `AggregatePipelineEntry`. Rename `MongoReadStage` → `MongoPipelineStage`. Add `MongoGroupStage`, `MongoAddFieldsStage`, `MongoReplaceRootStage`, `MongoFacetStage`, and all remaining stages. Extend `MongoProjectStage` to support aggregation expressions for computed fields. Add `MongoUpdateSpec` union to update commands for pipeline-style updates.

4. **Pipeline builder with type-safe shape tracking** — Fluent builder (`PipelineBuilder<QC, DocShape>`) that tracks how each pipeline stage transforms the document shape at the type level. `FieldProxy` for autocomplete, `TypedAggExpr<F>` for type-carrying expressions, accumulator and expression helpers. Compiles to `MongoQueryPlan` with `AggregateCommand`. Includes `computeUpdate()` for pipeline-style computed writes.

**Proof:** Pipeline builder executes multi-stage aggregation pipelines (match → group → sort → project) against `mongodb-memory-server` with full type inference. Pipeline-style updates compute values from existing fields. Raw pipeline API works for any aggregation the typed builder doesn't cover yet.

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
