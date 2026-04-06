# Summary

Build a type-safe, contract-aware MongoDB aggregation pipeline builder that tracks document shape transformations through pipeline stages at the type level. This is the Mongo equivalent of the SQL query builder — a lower-level escape hatch for queries the ORM can't express.

# Description

The ORM (`MongoCollection`) surfaces model-centric CRUD operations. It compiles to aggregation pipelines internally, but users think in model terms. For complex analytics, multi-stage transformations, cross-collection joins with sub-pipelines, and computed updates, users need direct access to MongoDB's aggregation pipeline with the same type safety the ORM provides for simple queries.

The core technical challenge is **tracking how the document shape transforms through the pipeline at the type level**. A `$group` produces a completely new shape from its accumulators. A `$project` narrows to included fields. An `$addFields` extends. A `$unwind` replaces an array field with its element type. The builder's type parameters must evolve through each transformation.

This work also introduces **pipeline-style updates** (MongoDB 4.2+), where aggregation expressions power computed writes — setting fields based on other fields' values, conditional logic, string concatenation, etc. The aggregation expression AST is shared infrastructure for both reads and writes.

**Users:** TypeScript developers who need aggregation queries beyond what the ORM expresses — analytics dashboards, reporting, data migrations, ETL pipelines, complex joins.

**Linear:** [TML-2207](https://linear.app/prisma-company/issue/TML-2207)

# Requirements

## Functional Requirements

### Raw pipeline API

- Users can execute raw MongoDB aggregation pipeline stages (plain objects) against a named collection via `db.rawPipeline(collection, stages)`
- The collection name is validated against the contract (must be a known model)
- Users can optionally assert the return row type via a type parameter
- Results are returned as `AsyncIterableResult<Row>`

### Aggregation expression AST

- Typed representation of MongoDB aggregation expressions as a class hierarchy (`MongoAggExpr` union) in `@prisma-next/mongo-query-ast`
- Covers field references (`$fieldName`), literal values, uniform operators (arithmetic, string, comparison, date, type, array, object, set), accumulators (`$sum`, `$avg`, `$min`, `$max`, `$push`, etc.), and structurally unique operators (`$cond`, `$switch`, `$filter`, `$map`, `$reduce`, `$let`, `$mergeObjects`)
- `MongoExprFilter` bridge class for `$expr` inside `$match` (cross-field comparisons in filter context)
- Visitor (`MongoAggExprVisitor<R>`) and rewriter (`MongoAggExprRewriter`) interfaces following the filter expression pattern
- Lowering to plain MongoDB driver documents via visitor
- Immutable, frozen instances following the `MongoAstNode` pattern

### Pipeline AST completeness

- Every MongoDB aggregation pipeline stage has a typed AST node class, eliminating `Record<string, unknown>` from `AggregatePipelineEntry`
- `MongoReadStage` renamed to `MongoPipelineStage`
- Existing stages extended: `MongoProjectStage` supports `MongoAggExpr` for computed fields, `MongoLookupStage` supports let/pipeline form, `MongoUnwindStage` gains `includeArrayIndex`
- New stages: `MongoGroupStage`, `MongoAddFieldsStage`, `MongoReplaceRootStage`, `MongoCountStage`, `MongoSortByCountStage`, `MongoFacetStage`, `MongoSetWindowFieldsStage`, `MongoBucketStage`, `MongoBucketAutoStage`, `MongoGraphLookupStage`, `MongoUnionWithStage`, `MongoOutStage`, `MongoMergeStage`, `MongoGeoNearStage`, `MongoDensifyStage`, `MongoFillStage`, `MongoRedactStage`, `MongoSampleStage`
- Atlas stages: `MongoSearchStage`, `MongoSearchMetaStage`, `MongoVectorSearchStage`
- Adapter lowering for all new stages
- `MongoStageVisitor<R>` extended with methods for all new stage kinds

### Pipeline builder

- Fluent, immutable, chainable `PipelineBuilder<QC, DocShape>` that tracks the current document shape as a type parameter
- Entry point via `mongoPipeline({ context }).from('collectionName')` deriving initial `DocShape` from the contract
- Identity stages: `match()`, `sort()`, `limit()`, `skip()`, `sample()`
- Additive stages: `addFields()`, `lookup()` (equality and pipeline forms)
- Narrowing stages: `project()` (inclusion and computed), `unwind()`
- Replacement stages: `group()`, `replaceRoot()`, `count()`, `sortByCount()`
- Multi-pipeline: `facet()`
- `FieldProxy<Shape>` provides autocomplete for field references in callbacks
- `FilterProxy<Shape>` provides trait-gated filter methods (`.eq()`, `.gt()`, etc.) for `match()` callbacks
- `TypedAggExpr<F>` wraps `MongoAggExpr` with phantom type parameter for output type tracking
- `AccumulatorHelpers` for `$group` (sum, avg, min, max, first, last, push, addToSet, count)
- `ExpressionHelpers` for computed fields (concat, add, subtract, multiply, divide, cond, literal, etc.)
- `.pipe(stage)` escape hatch for injecting raw `MongoPipelineStage` nodes
- `.build()` produces `MongoQueryPlan<ResolveRow<Shape, CodecTypes>>`
- `.execute()` returns `AsyncIterableResult<ResolveRow<Shape, CodecTypes>>`

### Pipeline-style updates

- `MongoUpdateSpec` union type: traditional `Record<string, MongoValue>` OR `ReadonlyArray<MongoUpdatePipelineStage>`
- Update commands (`UpdateOneCommand`, `UpdateManyCommand`, `FindOneAndUpdateCommand`) accept `MongoUpdateSpec`
- `computeUpdate()` and `computeUpdateOne()` terminal methods on the pipeline builder
- Adapter lowering dispatches between traditional and pipeline-style update forms

## Non-Functional Requirements

- No `any` types, `@ts-expect-error` (outside negative type tests), or `@ts-nocheck`
- Type casts minimized; `as unknown as T` only as last resort with justifying comment
- All AST node instances are immutable (frozen)
- Expression AST is contract-agnostic — deals in field paths and operator names, not codecs or TypeScript types
- Builder-level type machinery (`DocField`, `DocShape`, `ResolveRow`) bridges contract types to expression types
- Package location: `packages/2-mongo-family/5-query-builders/mongo-pipeline-builder/`
- Follows existing package layering rules (`pnpm lint:deps` passes)

## Non-goals

- Mongoose compatibility or migration tooling
- Custom/extension pipeline stages (generalized stage extensibility deferred)
- `$setWindowFields` type inference in the builder (complex, deferred to later iteration)
- `$lookup` pipeline form type inference for let bindings in the builder (deferred)
- Compound `$group._id` type inference producing typed objects (deferred)
- `$facet` sub-pipeline independent shape tracking in the builder (deferred)
- Real-time change stream integration
- Migration system integration (aggregation pipelines are read/analytics, not schema changes)

# Acceptance Criteria

### Raw pipeline

- [ ] `db.rawPipeline('orders', [{ $group: ... }, { $sort: ... }])` executes against mongodb-memory-server and returns correct results
- [ ] Collection name is validated against the contract — unknown collection name is a compile-time error
- [ ] Type parameter assertion works: `db.rawPipeline<{ _id: string; total: number }>('orders', stages)` produces typed results

### Aggregation expression AST

- [ ] All `MongoAggExpr` node classes extend `MongoAstNode`, are immutable (frozen), and have a `kind` discriminant
- [ ] `MongoAggExprVisitor<R>` is exhaustive — every expression kind must be handled
- [ ] `MongoAggExprRewriter` supports partial overrides (optional hooks per kind)
- [ ] `lowerAggExpr()` produces correct MongoDB driver documents for all expression node types
- [ ] `MongoExprFilter` bridge works in `$match` for cross-field comparisons: `{ $match: { $expr: { $gt: ["$qty", "$minQty"] } } }`

### Pipeline AST completeness

- [ ] `AggregatePipelineEntry` type and `Record<string, unknown>` arm are removed
- [ ] `AggregateCommand.pipeline` is `ReadonlyArray<MongoPipelineStage>`
- [ ] `MongoReadStage` is renamed to `MongoPipelineStage` across the codebase
- [ ] All new stage classes have working lowering (unit tested)
- [ ] All new stage classes have visitor and rewriter support
- [ ] Existing ORM code continues to compile without changes (backward compatible)
- [ ] Existing `aggregate.test.ts` uses typed stage classes instead of raw objects

### Pipeline builder

- [ ] `from('users').match(...).sort(...).limit(10).execute()` produces correctly typed results
- [ ] `group()` produces a replacement `DocShape` — previous fields are inaccessible after group
- [ ] `addFields()` extends the `DocShape` — new fields are accessible alongside existing ones
- [ ] `project()` narrows the `DocShape` — excluded fields are inaccessible
- [ ] `unwind()` replaces array field type with element type in `DocShape`
- [ ] `lookup()` adds an array field of the foreign collection's shape
- [ ] `replaceRoot()` replaces the entire `DocShape` with the embedded document's shape
- [ ] Multi-stage pipeline (match → group → sort → project) executes against mongodb-memory-server with full type inference
- [ ] `.pipe()` escape hatch injects raw stages without breaking the builder chain
- [ ] Type tests (`.test-d.ts`) verify shape tracking for all transformation categories

### Pipeline-style updates

- [ ] `computeUpdate()` with cross-field reference executes correctly (e.g., set fullName from firstName + lastName)
- [ ] `computeUpdate()` with conditional logic executes correctly (e.g., tier upgrade based on purchase count)
- [ ] Traditional operator updates continue to work unchanged (backward compatible)

# Other Considerations

## Security

No additional security concerns. The pipeline builder operates within the existing contract/runtime boundary. Pipeline stages are constructed as typed AST nodes, not raw strings, so injection is not a concern. The raw pipeline API passes plain objects through the existing driver path.

## Cost

No infrastructure cost implications. This is a compile-time/build-time library. Runtime cost is identical to the existing aggregation pipeline execution path.

## Observability

The pipeline builder produces `MongoQueryPlan` with `lane: 'mongo-pipeline'`, distinguishing pipeline-builder queries from ORM queries (`lane: 'mongo-orm'`) in any runtime instrumentation. The raw pipeline API uses `lane: 'mongo-raw'`.

## Data Protection

No change from existing Mongo data access patterns. The pipeline builder doesn't introduce new data access paths — it produces the same `AggregateCommand` the ORM already uses.

# References

- [Aggregation expression AST design](../orm-consolidation/plans/aggregation-expression-ast-design.md)
- [Pipeline AST completeness design](../orm-consolidation/plans/pipeline-ast-completeness-design.md)
- [Pipeline builder design](../orm-consolidation/plans/pipeline-builder-design.md)
- [ADR 183 — Aggregation pipeline only, never find API](../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [ADR 180 — Dot-path field accessor](../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)
- [SQL query builder](../../packages/2-sql/4-lanes/sql-builder/) — precedent for fluent API, immutable state, `ScopeField`/`ResolveRow`
- [MongoDB primitives reference](../../docs/reference/mongodb-primitives-reference.md)
- [Linear: TML-2207](https://linear.app/prisma-company/issue/TML-2207)

# Open Questions

1. **Builder entry point placement** — Should `rawPipeline()` and `mongoPipeline()` live on the existing `MongoOrmClient` returned by `mongoOrm()`, or on a separate client object? The ORM client is model-keyed (`db.users`, `db.posts`); the pipeline builder needs `from('collectionName')`. Adding both to one client is natural but widens the ORM client's scope.

2. **Nested field access in `FieldProxy`** — Should embedded document fields use chained property access (`fields.address.city`) or a dot-path helper (`fields("address.city")`)? Chained access requires recursive `Proxy` with recursive types. Dot-path is simpler. The SQL builder uses chained access. This intersects with value objects (Phase 1.75c).

3. **Expression helper coverage at launch** — How many typed expression helpers should exist in milestone 4? The `MongoAggOperator` with `op: string` can represent any operator at the AST level, but typed builder helpers provide autocomplete and type safety. Proposal: start with arithmetic, `$concat`, `$cond`, `$literal`, `$toUpper`/`$toLower`, `$size`, and expand based on usage.
