# Remaining Stages, Pipeline-Style Updates & Cleanup

## Summary

Complete the MongoDB aggregation pipeline stage AST in `@prisma-next/mongo-query-ast` so every pipeline stage is a typed node, add pipeline-style update support to write commands, add builder methods for all new stages, and clean up the structural debt (`MongoReadStage` naming, `Record<string, unknown>` escape hatch in `AggregatePipelineEntry`).

**Parent project:** [ORM Consolidation](../spec.md) — Phase 2.5, Milestone 3 (Pipeline AST completeness) + pipeline-style updates from the [pipeline AST completeness design](../plans/pipeline-ast-completeness-design.md).

**Linear:** [TML-2212](https://linear.app/prisma-company/issue/TML-2212)

## Description

The pipeline stage AST currently has 14 typed stages — enough for ORM read queries and the core pipeline builder methods. MongoDB's aggregation pipeline has ~28 stage types total. The remaining 14 stages are represented only via `Record<string, unknown>` in `AggregatePipelineEntry`, which means:

1. No compile-time validation — a typo in `{ $groop: ... }` compiles fine.
2. No visitor/rewriter support — stages that contain expressions or nested pipelines can't be recursively transformed.
3. No lowering — the adapter passes raw objects through without applying `lowerFilter()` or `lowerAggExpr()`, so `MongoFilterExpr` and `MongoAggExpr` nodes inside those stages would be silently ignored.
4. `PipelineBuilder` can't offer typed methods for stages it has no AST nodes for.

Separately, MongoDB 4.2+ supports passing an aggregation pipeline as the update parameter to `updateOne`/`updateMany`/`findOneAndUpdate`. This enables computed writes (setting fields based on other fields, conditional logic, etc.) that traditional `$set`/`$inc` operators cannot express. The current update commands only accept `Record<string, MongoValue>`, blocking this capability.

## Before / After

### Stage AST

**Before:**

```typescript
type AggregatePipelineEntry = MongoReadStage | Record<string, unknown>;

// A $facet stage is an untyped object — no visitor, no rewriting, no lowering
const facet = { $facet: { priceRanges: [...], topBrands: [...] } };
command.pipeline.push(facet); // compiles, but no type safety
```

**After:**

```typescript
// AggregatePipelineEntry is gone. AggregateCommand.pipeline is MongoPipelineStage[].
const facet = new MongoFacetStage({
  priceRanges: [new MongoGroupStage(...)],
  topBrands: [new MongoGroupStage(...), new MongoSortStage(...)],
});
// Typed, visitable, rewritable, lowerable
```

### Pipeline-style updates

**Before:**

```typescript
// Can only set literal values
new UpdateManyCommand(coll, filter, { $set: { tier: 'gold' } });
// Cannot reference other fields or use conditional logic
```

**After:**

```typescript
// Pipeline-style: compute values from existing fields
new UpdateManyCommand(coll, filter, [
  new MongoAddFieldsStage({
    tier: MongoAggCond.of(
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('purchases'), MongoAggLiteral.of(100)]),
      MongoAggLiteral.of('gold'),
      MongoAggLiteral.of('silver'),
    ),
  }),
]);
```

### Builder methods

**Before:** Only `pipe()` escape hatch for stages without builder methods.

**After:** Typed builder methods for `facet()`, `graphLookup()`, `unionWith()`, `bucket()`, `bucketAuto()`, `out()`, `merge()`, `setWindowFields()`, `geoNear()`, `redact()`.

## Requirements

### Functional Requirements

1. **Rename `MongoReadStage` → `MongoPipelineStage`.** The union type name reflects that the pipeline includes non-read stages (`$out`, `$merge`, `$count`).

2. **Add typed AST classes for all remaining MongoDB pipeline stages.** Each stage class extends `MongoStageNode`, has a `kind` discriminant, `accept()` for visitors, and `rewrite()` for transformations. Stages that contain `MongoAggExpr` or `MongoFilterExpr` fields recurse into them during rewriting. Stages that contain nested pipelines recurse into those.

   **Stages to add (14):**

   | Category | Stage | Key fields |
   |----------|-------|------------|
   | Multi-pipeline | `MongoFacetStage` | `facets: Record<string, MongoPipelineStage[]>` |
   | Joins | `MongoGraphLookupStage` | `from`, `startWith: MongoAggExpr`, `connectFromField`, `connectToField`, `as`, `maxDepth?`, `depthField?`, `restrictSearchWithMatch?: MongoFilterExpr` |
   | Joins | `MongoUnionWithStage` | `collection`, `pipeline?: MongoPipelineStage[]` |
   | Bucketing | `MongoBucketStage` | `groupBy: MongoAggExpr`, `boundaries`, `default_?`, `output?: Record<string, MongoAggAccumulator>` |
   | Bucketing | `MongoBucketAutoStage` | `groupBy: MongoAggExpr`, `buckets`, `output?`, `granularity?` |
   | Window | `MongoSetWindowFieldsStage` | `partitionBy?: MongoAggExpr`, `sortBy?`, `output: Record<string, MongoWindowField>` |
   | Output | `MongoOutStage` | `collection`, `db?` |
   | Output | `MongoMergeStage` | `into`, `on?`, `whenMatched?`, `whenNotMatched?` |
   | Geospatial | `MongoGeoNearStage` | `near`, `distanceField`, `spherical?`, `maxDistance?`, `query?: MongoFilterExpr`, etc. |
   | Time series | `MongoDensifyStage` | `field`, `partitionByFields?`, `range` |
   | Time series | `MongoFillStage` | `partitionBy?`, `sortBy?`, `output` |
   | Atlas | `MongoSearchStage` | `index?`, `config: Record<string, unknown>` |
   | Atlas | `MongoSearchMetaStage` | `index?`, `config: Record<string, unknown>` |
   | Atlas | `MongoVectorSearchStage` | `index`, `path`, `queryVector`, `numCandidates`, `limit`, `filter?` |

3. **Update `MongoStageVisitor<R>` with methods for all new stages.** The visitor remains exhaustive.

4. **Add lowering for all new stages.** Each stage kind maps to the corresponding MongoDB wire document via `lowerStage()`. Stages containing expressions call `lowerAggExpr()`. Stages containing filters call `lowerFilter()`. Stages containing nested pipelines call `lowerStage()` recursively.

5. **Eliminate `AggregatePipelineEntry`.** After all stages are typed, `AggregateCommand.pipeline` becomes `ReadonlyArray<MongoPipelineStage>`. Remove `isTypedStage()` and the raw pass-through branch in `lowerPipeline()`.

6. **Add `MongoUpdateSpec` and `MongoUpdatePipelineStage` types.** `MongoUpdatePipelineStage = MongoAddFieldsStage | MongoProjectStage | MongoReplaceRootStage`. `MongoUpdateSpec = Record<string, MongoValue> | ReadonlyArray<MongoUpdatePipelineStage>`.

7. **Update write commands to accept pipeline-style updates.** `UpdateOneCommand`, `UpdateManyCommand`, and `FindOneAndUpdateCommand` change `.update` from `Record<string, MongoValue>` to `MongoUpdateSpec`. Existing ORM code continues to pass traditional operator documents.

8. **Update adapter lowering for pipeline-style updates.** The adapter's `lower()` detects pipeline-style updates (array) vs traditional (object) and lowers accordingly. The wire commands already accept `Document | ReadonlyArray<Document>`.

9. **Add builder methods on `PipelineBuilder` for new stages.** At minimum: `facet()`, `graphLookup()`, `unionWith()`, `bucket()`, `bucketAuto()`, `out()`, `merge()`, `setWindowFields()`, `geoNear()`, `redact()`. Niche stages (`densify`, `fill`, `search`, `searchMeta`, `vectorSearch`) are reachable via `pipe()`.

### Non-Functional Requirements

- Each new stage class is immutable (frozen after construction), following the existing pattern.
- Array and record fields on stage classes are shallow-frozen.
- The `lowerStage()` switch remains exhaustive (the `default: never` branch catches missing cases).

## Non-Goals

- **Builder-level `computeUpdate()` / `computeUpdateOne()` terminal methods.** The pipeline-style update infrastructure (command types + adapter lowering) lands here. A builder API that constructs pipeline-style updates ergonomically can follow.
- **Type-level shape tracking for new builder methods.** Shape-preserving methods (`redact`) are trivial. Shape-transforming methods (especially `facet`, `setWindowFields`) have complex type-level implications — the initial builder methods may use the `pipe()` pattern (preserve or assert shape) for complex stages, with precise shape tracking as a follow-up.
- **Expanding `fn` / `acc` helpers.** Covered by [TML-2217](https://linear.app/prisma-company/issue/TML-2217).

## Acceptance Criteria

### Stage AST completeness

- [ ] `MongoReadStage` is renamed to `MongoPipelineStage` — no references to the old name remain
- [ ] All 14 remaining pipeline stages have typed AST classes with `kind`, `accept()`, `rewrite()`
- [ ] `MongoStageVisitor<R>` has methods for all 28 stage kinds
- [ ] `lowerStage()` handles all 28 stage kinds (exhaustive switch)
- [ ] `AggregatePipelineEntry` type is removed — `AggregateCommand.pipeline` is `ReadonlyArray<MongoPipelineStage>`
- [ ] `isTypedStage()` and the raw pass-through in `lowerPipeline()` are removed
- [ ] Each new stage has unit tests: construction, frozen, rewrite (with and without expressions), visitor dispatch
- [ ] Each new stage has lowering tests

### Pipeline-style updates

- [ ] `MongoUpdateSpec` type exists: `Record<string, MongoValue> | ReadonlyArray<MongoUpdatePipelineStage>`
- [ ] `UpdateOneCommand`, `UpdateManyCommand`, `FindOneAndUpdateCommand` accept `MongoUpdateSpec`
- [ ] Adapter lowers pipeline-style updates by calling `lowerStage()` on each stage
- [ ] Adapter lowers traditional updates unchanged (existing behavior preserved)
- [ ] Unit tests for both update forms at the command, adapter, and lowering level

### Builder methods

- [ ] `PipelineBuilder` has typed methods for: `facet`, `graphLookup`, `unionWith`, `bucket`, `bucketAuto`, `out`, `merge`, `setWindowFields`, `geoNear`, `redact`
- [ ] Each builder method produces the correct AST stage node
- [ ] Unit tests for each new builder method

### Pipeline DSL row-type safety

Every pipeline transformation, operation, and expression must have a type-level test proving that the **resolved row type** (i.e. the concrete field types after `ResolveRow`) is correct — not just that the shape keys are present. The existing shape tests (e.g. "sort accepts/rejects keys") are necessary but not sufficient: they only test the intermediate `DocShape`, not the final row type a user receives from `execute()`.

- [ ] `build()` produces `MongoQueryPlan<Row>` where `Row` resolves to concrete field types (e.g. `{ _id: string; status: string; amount: number }`) — not `MongoQueryPlan<unknown>`
- [ ] `from()` → `build()`: row type matches the model's fields resolved through codec types
- [ ] `match()` preserves row type
- [ ] `sort()` preserves row type
- [ ] `limit()` / `skip()` / `sample()` preserve row type
- [ ] `addFields()`: row type extends with the new fields at their correct resolved types
- [ ] `project()` (inclusion): row type narrows to the selected fields at correct types
- [ ] `project()` (computed): row type includes computed expression fields at correct types
- [ ] `group()`: row type has `_id` at the grouped-by field's type, accumulator fields at their correct types (e.g. `acc.sum()` → `number`, `acc.count()` → `number`, `acc.max()` → `T | null`)
- [ ] `unwind()`: row type preserves shape (array field element type tracking is deferred)
- [ ] `count()`: row type is `{ [field]: number }`
- [ ] `sortByCount()`: row type is `{ _id: <field type>; count: number }`
- [ ] `lookup()`: row type adds the `as` field as `unknown[]`, preserves existing fields at correct types
- [ ] `replaceRoot()`: row type is the new shape resolved to concrete types
- [ ] `pipe()`: row type is preserved or narrowed as specified by the type parameter
- [ ] Nullable fields resolve to `T | null`
- [ ] Chained pipelines (e.g. `match → group → sort → limit → build`) produce correct cumulative row types
- [ ] `runtime.execute(plan)` returns `AsyncIterableResult<Row>` where `Row` matches `build()`'s row type

## References

- [Pipeline AST completeness design](../plans/pipeline-ast-completeness-design.md)
- [Pipeline builder design](../plans/pipeline-builder-design.md)
- [Aggregation expression AST design](../plans/aggregation-expression-ast-design.md)
- [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [MongoDB aggregation pipeline stages reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation-pipeline/)
