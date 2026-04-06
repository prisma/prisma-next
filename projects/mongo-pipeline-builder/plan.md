# Mongo Pipeline Builder — Execution Plan

## Summary

Build a type-safe MongoDB aggregation pipeline builder that tracks document shape transformations at the type level, plus the aggregation expression AST that powers both read pipelines and computed writes. The raw pipeline API ships first as an immediate escape hatch; the typed builder grows incrementally through vertical slices that each deliver end-to-end functionality.

**Spec:** [projects/mongo-pipeline-builder/spec.md](spec.md)

**Linear:** [TML-2207](https://linear.app/prisma-company/issue/TML-2207)

**Design docs:**
- [Aggregation expression AST](../orm-consolidation/plans/aggregation-expression-ast-design.md)
- [Pipeline AST completeness](../orm-consolidation/plans/pipeline-ast-completeness-design.md)
- [Pipeline builder](../orm-consolidation/plans/pipeline-builder-design.md)

## Collaborators

| Role | Person | Context |
|---|---|---|
| Maker | Will | Drives execution |

## Milestones

### Milestone 1: Raw pipeline API

Ship a user-facing `rawPipeline()` that executes plain MongoDB pipeline stage documents. This proves the full execution path end-to-end and gives users an immediate escape hatch before any typed AST work.

**Validation:** Integration test seeds data into mongodb-memory-server, runs a `$group` + `$sort` pipeline via `rawPipeline()`, and verifies correct aggregated results with a user-asserted return type.

**Tasks:**

- [ ] 1.1 — Add `rawPipeline<Row>(collection, stages)` method to the mongo client surface in `5-query-builders`. Internally constructs `AggregateCommand` with raw stages and executes via `MongoQueryExecutor`. Collection name validated against contract at the type level.
- [ ] 1.2 — Integration test: seed order data, execute `$group` + `$sort` pipeline, verify aggregated results. Test type assertion (`rawPipeline<{ _id: string; total: number }>`).
- [ ] 1.3 — Export wiring and package.json updates for the new API surface.

### Milestone 2: Aggregation expression AST

Build the typed `MongoAggExpr` class hierarchy — the foundation that every subsequent milestone depends on. This milestone is pure AST infrastructure with no pipeline integration yet.

**Validation:** Unit tests verify construction, freezing, visitor dispatch, rewriter transforms, and lowering to MongoDB driver documents for all expression node types.

**Tasks:**

- [ ] 2.1 — `MongoAggExprNode` abstract base class (extends `MongoAstNode`, hidden from export). `MongoAggFieldRef` (kind: `fieldRef`, field path reference). `MongoAggLiteral` (kind: `literal`, constant value with `$literal` escape for ambiguous values). Unit tests for construction, freezing, kind discriminant.
- [ ] 2.2 — `MongoAggOperator` (kind: `operator`, uniform `{ $op: expr | [expr] }` shape with `op: string`). `MongoAggAccumulator` (kind: `accumulator`, group/window accumulators with `op: string` + `arg`). Unit tests.
- [ ] 2.3 — `MongoAggExprVisitor<R>` (exhaustive) and `MongoAggExprRewriter` (optional hooks) interfaces. `accept()` and `rewrite()` on all node classes. Tests for visitor dispatch and rewriter identity/transform.
- [ ] 2.4 — `lowerAggExpr()` visitor implementation. Tests: lowering of field refs, literals (including `$literal` escape), operators (single-arg and array-arg), accumulators. Verify round-trip: construct AST → lower → compare to expected MongoDB document.
- [ ] 2.5 — Structurally unique expression nodes: `MongoAggCond`, `MongoAggSwitch`, `MongoAggFilter`, `MongoAggMap`, `MongoAggReduce`, `MongoAggLet`, `MongoAggMergeObjects`. Each with construction, visitor, rewriter, lowering tests.
- [ ] 2.6 — `MongoExprFilter` bridge class in filter expressions (`kind: 'expr'`). Update `MongoFilterExpr` union and `MongoFilterVisitor`/`MongoFilterRewriter`. Update `lowerFilter()` to handle `expr` kind. Test: `{ $match: { $expr: { $gt: ["$qty", "$minQty"] } } }`.
- [ ] 2.7 — Export `MongoAggExpr` union and all concrete classes from `@prisma-next/mongo-query-ast` exports.

### Milestone 3: Core pipeline stage extensions + `$group` end-to-end

Extend the stage AST with the most important new stages (`$group`, `$addFields`, `$project` computed, `$replaceRoot`, `$count`) and prove they execute correctly through the full stack.

**Validation:** Integration test constructs a multi-stage typed pipeline (`MongoMatchStage` → `MongoGroupStage` → `MongoSortStage`) and executes it against mongodb-memory-server with correct results. Existing ORM tests pass unchanged.

**Tasks:**

- [ ] 3.1 — `MongoGroupStage` class (kind: `group`). Fields: `groupId: MongoGroupId`, `accumulators: Record<string, MongoAggAccumulator>`. Rewriter recurses into groupId and accumulator expressions. Unit tests for construction, visitor, rewriter.
- [ ] 3.2 — `MongoAddFieldsStage` class (kind: `addFields`). Fields: `fields: Record<string, MongoAggExpr>`. `$addFields` and `$set` are aliases; AST uses one class, lowering emits `$addFields`. Unit tests.
- [ ] 3.3 — Extend `MongoProjectStage`: widen projection value from `Record<string, 0 | 1>` to `Record<string, 0 | 1 | MongoAggExpr>`. Lowering calls `lowerAggExpr()` for expression values, passes through `0`/`1`. Unit tests. Verify existing ORM usage still compiles (backward compat).
- [ ] 3.4 — `MongoReplaceRootStage` (kind: `replaceRoot`), `MongoCountStage` (kind: `count`), `MongoSortByCountStage` (kind: `sortByCount`), `MongoSampleStage` (kind: `sample`), `MongoRedactStage` (kind: `redact`). Construction, visitor, rewriter, lowering tests for each.
- [ ] 3.5 — Extend `MongoLookupStage` with `let_` and `pipeline` fields for correlated sub-queries. Extend `MongoUnwindStage` with `includeArrayIndex`. Update lowering and tests.
- [ ] 3.6 — Update `MongoStageVisitor<R>` and `MongoStageRewriter` with methods for all new stage kinds.
- [ ] 3.7 — Adapter lowering: add cases to `lowerStage()` in `adapter-mongo/src/lowering.ts` for all new stages. Calls `lowerAggExpr()` for stages with expressions.
- [ ] 3.8 — Integration test: construct `MongoMatchStage` → `MongoGroupStage` → `MongoSortStage` pipeline as typed AST, execute through runtime, verify results. Update existing `aggregate.test.ts` to use typed stages instead of raw objects.

### Milestone 4: Pipeline builder with shape tracking

Build the fluent `PipelineBuilder<QC, DocShape>` that tracks document shape transformations at the type level. This is the main user-facing deliverable.

**Validation:** Type tests verify shape tracking for all transformation categories. Integration tests execute multi-stage pipelines against mongodb-memory-server with full type inference.

**Tasks:**

- [ ] 4.1 — Scaffold `packages/2-mongo-family/5-query-builders/mongo-pipeline-builder/` package. `package.json`, `tsconfig.json`, `tsdown.config.ts`, exports, layering config.
- [ ] 4.2 — Core type machinery: `DocField`, `DocShape`, `ModelToDocShape<Contract, ModelName>`, `ResolveRow<Shape, CodecTypes>`. Type tests verifying contract → DocShape derivation and DocShape → concrete types resolution.
- [ ] 4.3 — `PipelineBuilder<QC, Shape>` class with immutable state (`PipelineBuilderState`). `cloneState()` pattern. Identity stage methods: `match(filter)`, `sort(spec)`, `limit(n)`, `skip(n)`, `sample(n)`. `build()` → `MongoQueryPlan`. `execute()` → `AsyncIterableResult`. Type tests: shape is unchanged after identity stages.
- [ ] 4.4 — `FieldProxy<Shape>` and `FilterProxy<Shape>`. `match()` callback overload: `match(fn: (fields: FilterProxy<Shape>) => MongoFilterExpr)`. `SortSpec<Shape>` constrained to current shape keys. Type tests and unit tests.
- [ ] 4.5 — `TypedAggExpr<F>` wrapper. `ExpressionHelpers` (concat, add, subtract, multiply, divide, cond, literal, toLower, toUpper, size, slice). `addFields()` method with `Shape & ExtractDocShape<NewFields>` return type. Type tests: new fields accessible, existing fields preserved.
- [ ] 4.6 — `project()` — both inclusion overload (`project('field1', 'field2')` → `Pick<Shape>`) and computed overload (callback returning `Record<string, 1 | TypedAggExpr>`). Type tests: excluded fields inaccessible, computed fields have correct types.
- [ ] 4.7 — `AccumulatorHelpers` (sum, avg, min, max, first, last, push, addToSet, count). `group()` method with `GroupedDocShape<Spec>` return type. Type tests: previous shape replaced, accumulator output types correct.
- [ ] 4.8 — `unwind()` with `UnwoundShape<Shape, K>` (array → element type). Type tests.
- [ ] 4.9 — `lookup()` (equality form) with foreign collection shape addition. `replaceRoot()` with embedded document navigation. `count()` and `sortByCount()`. Type tests for each.
- [ ] 4.10 — `.pipe(stage)` escape hatch (shape-preserving and shape-asserting overloads). Entry point: `mongoPipeline({ context }).from('collection')` or proxy-based `pipeline.users`.
- [ ] 4.11 — Integration tests against mongodb-memory-server: (a) match → group → sort → limit, (b) addFields → match on computed field, (c) lookup → unwind → project, (d) replaceRoot into embedded document.
- [ ] 4.12 — Export wiring from `mongo-pipeline-builder` package. Update `pnpm lint:deps` layering config.

### Milestone 5: Remaining stages, pipeline-style updates, cleanup

Complete AST coverage for all MongoDB pipeline stages, add pipeline-style updates, and remove the `Record<string, unknown>` escape hatch.

**Validation:** `AggregatePipelineEntry` type is deleted. Pipeline-style updates execute against mongodb-memory-server. All existing tests pass.

**Tasks:**

- [ ] 5.1 — Remaining pipeline stage classes: `MongoFacetStage`, `MongoGraphLookupStage`, `MongoUnionWithStage`, `MongoBucketStage`, `MongoBucketAutoStage`, `MongoSetWindowFieldsStage`, `MongoOutStage`, `MongoMergeStage`, `MongoGeoNearStage`, `MongoDensifyStage`, `MongoFillStage`. Construction, visitor, rewriter, lowering tests for each.
- [ ] 5.2 — Atlas stages: `MongoSearchStage`, `MongoSearchMetaStage`, `MongoVectorSearchStage`. Config is opaque `Record<string, unknown>` since Atlas Search has its own query language. Tests.
- [ ] 5.3 — Rename `MongoReadStage` → `MongoPipelineStage` across the codebase. Update all imports and references.
- [ ] 5.4 — Delete `AggregatePipelineEntry` type. Change `AggregateCommand.pipeline` to `ReadonlyArray<MongoPipelineStage>`. Remove `isTypedStage()` pass-through in adapter lowering. Verify all consumers compile.
- [ ] 5.5 — `MongoUpdateSpec` union type (`Record<string, MongoValue> | ReadonlyArray<MongoUpdatePipelineStage>`). `MongoUpdatePipelineStage` = `MongoAddFieldsStage | MongoProjectStage | MongoReplaceRootStage`. Widen `update` field on `UpdateOneCommand`, `UpdateManyCommand`, `FindOneAndUpdateCommand`.
- [ ] 5.6 — Adapter lowering for pipeline-style updates: dispatch based on array (pipeline) vs object (traditional). Reuse `lowerStage()` for pipeline stages.
- [ ] 5.7 — `computeUpdate()` and `computeUpdateOne()` terminal methods on `PipelineBuilder`. Extract match filter, construct `MongoAddFieldsStage` from expression callback, package into update command.
- [ ] 5.8 — Integration tests: (a) computed update with cross-field reference (`fullName` from `firstName` + `lastName`), (b) conditional update (tier upgrade based on purchase count), (c) traditional operator update still works (backward compat).
- [ ] 5.9 — Builder methods for remaining stages where feasible: `facet()` basic form (independent sub-pipelines), builder-level `$lookup` pipeline form.

### Close-out

- [ ] Verify all acceptance criteria in [spec.md](spec.md)
- [ ] Finalize any ADRs if architectural decisions warrant them
- [ ] Migrate long-lived docs into `docs/` (update subsystem doc for MongoDB Family)
- [ ] Update design doc references in `projects/orm-consolidation/plan.md` to point to canonical `docs/` locations
- [ ] Strip repo-wide references to `projects/mongo-pipeline-builder/**`
- [ ] Delete `projects/mongo-pipeline-builder/`

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `rawPipeline` executes and returns correct results | Integration | 1.2 | mongodb-memory-server |
| Collection name validated against contract | Type test | 1.2 | Compile-time error for unknown collection |
| Type parameter assertion on rawPipeline | Type test | 1.2 | `.test-d.ts` |
| All MongoAggExpr nodes are immutable with kind discriminant | Unit | 2.1–2.5 | Construction + freeze tests |
| MongoAggExprVisitor is exhaustive | Unit | 2.3 | Visitor dispatch test |
| MongoAggExprRewriter supports partial overrides | Unit | 2.3 | Rewriter with one hook |
| lowerAggExpr produces correct documents | Unit | 2.4–2.5 | Round-trip tests |
| MongoExprFilter bridge works in $match | Unit + Integration | 2.6 | Cross-field comparison |
| AggregatePipelineEntry removed | Compilation | 5.4 | Type deleted, all consumers compile |
| AggregateCommand.pipeline is MongoPipelineStage[] | Compilation | 5.4 | Type change verified |
| MongoReadStage renamed to MongoPipelineStage | Compilation | 5.3 | All imports updated |
| All new stages have lowering | Unit | 3.1–3.7, 5.1–5.2 | Lower → compare expected doc |
| All new stages have visitor/rewriter | Unit | 3.1–3.6, 5.1–5.2 | Visitor dispatch, rewriter identity |
| Existing ORM code compiles unchanged | Compilation | 3.3, 5.4 | Backward compat verification |
| aggregate.test.ts uses typed stages | Integration | 3.8 | Updated test |
| Builder match/sort/limit produces typed results | Integration + Type | 4.3–4.4, 4.11a | Shape unchanged |
| group() produces replacement DocShape | Type test | 4.7 | Previous fields inaccessible |
| addFields() extends DocShape | Type test | 4.5 | New + existing fields accessible |
| project() narrows DocShape | Type test | 4.6 | Excluded fields inaccessible |
| unwind() replaces array with element type | Type test | 4.8 | Array field → element |
| lookup() adds array field | Type test | 4.9 | Foreign shape as array |
| replaceRoot() replaces entire DocShape | Type test | 4.9 | Embedded doc shape |
| Multi-stage pipeline executes with type inference | Integration | 4.11 | mongodb-memory-server |
| .pipe() escape hatch works | Unit + Type | 4.10 | Shape preserved/asserted |
| computeUpdate with cross-field reference | Integration | 5.8a | Set fullName from parts |
| computeUpdate with conditional logic | Integration | 5.8b | Tier upgrade |
| Traditional updates unchanged | Integration | 5.8c | Backward compat |

## Open Items

1. **Builder entry point** — Should `rawPipeline()` and `mongoPipeline()` live on `MongoOrmClient` or a separate client? Resolve during milestone 1 (decide when implementing).
2. **Nested field access in FieldProxy** — Chained property access vs dot-path. Defer to milestone 4 implementation; start with flat fields, iterate.
3. **Expression helper coverage** — Start with arithmetic + concat + cond + literal + toLower/toUpper + size. Expand based on usage during milestone 4.
4. **`$facet` sub-pipeline typing** — Complex type-level work. Basic form in milestone 5; independent shape tracking deferred.
5. **`$lookup` pipeline form typing** — Let bindings + foreign scope in type system. Basic form in milestone 5; full type inference deferred.
6. **Window function type inference** — `$setWindowFields` stage exists in AST (milestone 5) but builder method deferred.
7. **Accumulator output type precision** — Pragmatic default: all numeric accumulators produce `'double'`. Precision improvement (int→int, double→double) deferred.
