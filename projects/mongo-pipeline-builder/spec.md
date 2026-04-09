# Summary

Build a type-safe, contract-aware MongoDB aggregation pipeline builder that tracks document shape transformations through pipeline stages at the type level. This is the Mongo equivalent of the SQL query builder — a lower-level escape hatch for queries the ORM can't express.

# Description

The ORM (`MongoCollection`) surfaces model-centric CRUD operations. It compiles to aggregation pipelines internally, but users think in model terms. For complex analytics, multi-stage transformations, cross-collection joins with sub-pipelines, and computed updates, users need direct access to MongoDB's aggregation pipeline with the same type safety the ORM provides for simple queries.

The core technical challenge is **tracking how the document shape transforms through the pipeline at the type level**. A `$group` produces a completely new shape from its accumulators. A `$project` narrows to included fields. An `$addFields` extends. A `$unwind` replaces an array field with its element type. The builder's type parameters must evolve through each transformation.

**Users:** TypeScript developers who need aggregation queries beyond what the ORM expresses — analytics dashboards, reporting, data migrations, ETL pipelines, complex joins.

**Linear:** [TML-2207](https://linear.app/prisma-company/issue/TML-2207)

# Status

| Milestone | Linear | Status |
|---|---|---|
| M1: Raw pipeline API | [TML-2208](https://linear.app/prisma-company/issue/TML-2208) | ✅ Complete |
| M2: Aggregation expression AST | [TML-2209](https://linear.app/prisma-company/issue/TML-2209) | ✅ Complete |
| M3: Core pipeline stage extensions | [TML-2210](https://linear.app/prisma-company/issue/TML-2210) | ✅ Complete |
| **M4: Pipeline builder with shape tracking** | [TML-2211](https://linear.app/prisma-company/issue/TML-2211) | **In progress** |
| M5: Remaining stages, pipeline-style updates | [TML-2212](https://linear.app/prisma-company/issue/TML-2212) | To-do |
| Follow-up: Complete expression helpers | [TML-2217](https://linear.app/prisma-company/issue/TML-2217) | ✅ Complete |

# Requirements

## Functional Requirements

### ~~Raw pipeline API~~ ✅

Delivered by TML-2208. `mongoRaw().collection(root).aggregate(pipeline)` provides a raw pipeline API with `RawAggregateCommand`.

### ~~Aggregation expression AST~~ ✅

Delivered by TML-2209. `MongoAggExpr` class hierarchy (11 node types), visitor/rewriter, `lowerAggExpr()`, and `MongoExprFilter` bridge for `$expr` in `$match`.

### ~~Pipeline AST completeness (core stages)~~ ✅

Delivered by TML-2210. 14 typed stage classes in the `MongoReadStage` union, with full adapter lowering and visitor/rewriter support.

### Pipeline builder

- Fluent, immutable, chainable `PipelineBuilder<TContract, DocShape>` that tracks the current document shape as a type parameter
- **Static builder** — `build()` produces `MongoQueryPlan<ResolveRow<Shape, CodecTypes>>`. No `execute()` — the user passes the plan to their runtime separately
- Entry point via `mongoPipeline<Contract>({ contractJson }).from('collectionName')` deriving initial `DocShape` from the contract
- Identity stages: `match()`, `sort()`, `limit()`, `skip()`, `sample()`
- Additive stages: `addFields()`, `lookup()` (equality form)
- Narrowing stages: `project()` (inclusion and computed), `unwind()`
- Replacement stages: `group()`, `replaceRoot()`, `count()`, `sortByCount()`
- `FieldProxy<Shape>` provides autocomplete for field references in callbacks (flat fields only; nested access deferred to value objects)
- `FilterProxy<Shape>` provides filter methods (`.eq()`, `.gt()`, etc.) for `match()` callbacks
- `TypedAggExpr<F>` wraps `MongoAggExpr` with phantom type parameter for output type tracking
- `AccumulatorHelpers` for `$group` (sum, avg, min, max, first, last, push, addToSet, count)
- `ExpressionHelpers` starter set (concat, add, subtract, multiply, divide, cond, literal, toLower, toUpper, size). Full coverage: [TML-2217](https://linear.app/prisma-company/issue/TML-2217)
- `.pipe(stage)` escape hatch for injecting raw `MongoReadStage` nodes

### Pipeline AST completeness (remaining stages) — TML-2212

- Remaining stage classes (`MongoFacetStage`, `MongoGraphLookupStage`, Atlas stages, etc.) eliminating `Record<string, unknown>` from `AggregatePipelineEntry`
- `MongoReadStage` renamed to `MongoPipelineStage`

### Pipeline-style updates — TML-2212

- `MongoUpdateSpec` union type: traditional `Record<string, MongoValue>` OR `ReadonlyArray<MongoUpdatePipelineStage>`
- `computeUpdate()` and `computeUpdateOne()` terminal methods on the pipeline builder
- Adapter lowering dispatches between traditional and pipeline-style update forms

## Non-Functional Requirements

- No `any` types, `@ts-expect-error` (outside negative type tests), or `@ts-nocheck`
- Type casts minimized; `as unknown as T` only as last resort with justifying comment
- All AST node instances are immutable (frozen)
- Expression AST is contract-agnostic — deals in field paths and operator names, not codecs or TypeScript types
- Builder-level type machinery (`DocField`, `DocShape`, `ResolveRow`) bridges contract types to expression types
- Package location: `packages/2-mongo-family/5-query-builders/pipeline-builder/` (under restructured `5-query-builders/`)
- Follows existing package layering rules (`pnpm lint:deps` passes)
- No runtime dependencies — the builder is a static plan construction tool

## Non-goals

- Mongoose compatibility or migration tooling
- Custom/extension pipeline stages (generalized stage extensibility deferred)
- `$setWindowFields` type inference in the builder (complex, deferred)
- `$lookup` pipeline form type inference for let bindings in the builder (deferred)
- Compound `$group._id` type inference producing typed objects (deferred)
- `$facet` sub-pipeline independent shape tracking in the builder (deferred)
- Real-time change stream integration
- Migration system integration
- Nested field access in `FieldProxy` (deferred until value objects land — ADR 180)
- ~~Full expression/accumulator helper coverage at launch~~ — Delivered by [TML-2217](https://linear.app/prisma-company/issue/TML-2217)
- `execute()` on the builder itself (static builder produces plans only)

# Acceptance Criteria

### Pipeline builder (TML-2211)

- [ ] `from('orders').match(...).sort(...).limit(10).build()` produces a correctly typed `MongoQueryPlan`
- [ ] `group()` produces a replacement `DocShape` — previous fields are inaccessible after group
- [ ] `addFields()` extends the `DocShape` — new fields are accessible alongside existing ones
- [ ] `project()` narrows the `DocShape` — excluded fields are inaccessible
- [ ] `unwind()` replaces array field type with element type in `DocShape`
- [ ] `lookup()` adds an array field of the foreign collection's shape
- [ ] `replaceRoot()` replaces the entire `DocShape` with the embedded document's shape
- [ ] Multi-stage pipeline (match → group → sort → limit) executes against mongodb-memory-server with full type inference
- [ ] `.pipe()` escape hatch injects raw stages without breaking the builder chain
- [ ] Type tests (`.test-d.ts`) verify shape tracking for all transformation categories
- [ ] ORM code compiles unchanged after `5-query-builders/` restructure

### Pipeline AST completeness (TML-2212)

- [ ] `AggregatePipelineEntry` type and `Record<string, unknown>` arm are removed
- [ ] `AggregateCommand.pipeline` is `ReadonlyArray<MongoPipelineStage>`
- [ ] `MongoReadStage` is renamed to `MongoPipelineStage` across the codebase

### Pipeline-style updates (TML-2212)

- [ ] `computeUpdate()` with cross-field reference executes correctly
- [ ] `computeUpdate()` with conditional logic executes correctly
- [ ] Traditional operator updates continue to work unchanged

# Other Considerations

## Security

No additional security concerns. Pipeline stages are constructed as typed AST nodes, not raw strings, so injection is not a concern.

## Cost

No infrastructure cost implications. This is a compile-time/build-time library. Runtime cost is identical to the existing aggregation pipeline execution path.

## Observability

The pipeline builder produces `MongoQueryPlan` with `lane: 'mongo-pipeline'`, distinguishing pipeline-builder queries from ORM queries (`lane: 'mongo-orm'`) in any runtime instrumentation.

## Data Protection

No change from existing Mongo data access patterns. The pipeline builder produces the same `AggregateCommand` the ORM already uses.

# References

- [Pipeline builder task plan](plans/pipeline-builder-plan.md) — detailed design for TML-2211
- [ADR 183 — Aggregation pipeline only, never find API](../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [ADR 180 — Dot-path field accessor](../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)
- [SQL query builder](../../packages/2-sql/4-lanes/sql-builder/) — precedent for fluent API, immutable state, `ScopeField`/`ResolveRow`
- [MongoDB primitives reference](../../docs/reference/mongodb-primitives-reference.md)

# Resolved Questions

1. ~~**Builder entry point placement**~~ — Separate root constructor: `mongoPipeline<Contract>({ contractJson })`. Not on `MongoOrmClient`. Analogous to `postgres<Contract>({ contractJson })`.
2. ~~**Nested field access in `FieldProxy`**~~ — Flat fields only for now. Deep/dot-path access deferred until value objects land (ADR 180).
3. ~~**Expression helper coverage at launch**~~ — Starter set in TML-2211. Full coverage delivered by [TML-2217](https://linear.app/prisma-company/issue/TML-2217).
4. ~~**Accumulator output type precision**~~ — Addressed in [TML-2217](https://linear.app/prisma-company/issue/TML-2217). `acc.sum` is now generic, preserving input codec type. `avg`/`stdDev*` remain as double (correct for MongoDB).
5. ~~**Builder runtime vs static**~~ — Static. `build()` returns `MongoQueryPlan`. No `execute()`.
6. ~~**Package location**~~ — Restructure `5-query-builders/` into `orm/` and `pipeline-builder/`.
