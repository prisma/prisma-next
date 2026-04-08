# Remaining Stages, Pipeline-Style Updates & Cleanup — Execution Plan

## Summary

Complete the pipeline stage AST to cover all MongoDB aggregation stages, add pipeline-style update support to write commands, add builder methods for new stages, and clean up structural debt. Success means every pipeline stage is a typed, visitable, rewritable, lowerable AST node; update commands accept both traditional operators and aggregation pipelines; the builder has methods for all major stages; and the `Record<string, unknown>` escape hatch is eliminated.

**Spec:** [specs/remaining-stages-pipeline-style-updates.spec.md](../specs/remaining-stages-pipeline-style-updates.spec.md)

**Linear:** [TML-2212](https://linear.app/prisma-company/issue/TML-2212)

## Collaborators

| Role | Person | Context |
|------|--------|---------|
| Maker | Will | Drives execution |

## Milestones

### Milestone 1: Complete pipeline stage AST + cleanup

Complete the typed AST so every MongoDB pipeline stage is a first-class node. Eliminate the untyped escape hatch. Add builder methods for all new stages.

**Validation:** All 28 pipeline stage kinds have AST classes, visitor methods, rewrite support, lowering, and tests. `AggregateCommand.pipeline` is `ReadonlyArray<MongoPipelineStage>` with no `Record<string, unknown>` arm. Builder has methods for all major stages.

**Tasks:**

- [ ] Rename `MongoReadStage` → `MongoPipelineStage` across `stages.ts`, `commands.ts`, `visitors.ts`, `exports/index.ts`, `lowering.ts`, `builder.ts`, and all test files. Pure rename, no behavior change.
- [ ] Add simple/terminal stages: `MongoOutStage`, `MongoUnionWithStage` — AST classes, visitor methods, rewrite, lowering, tests, exports
- [ ] Add expression-based stages: `MongoBucketStage`, `MongoBucketAutoStage`, `MongoGeoNearStage` — AST classes, visitor methods, rewrite (recurse into `MongoAggExpr` / `MongoFilterExpr`), lowering, tests, exports
- [ ] Add nested pipeline stages: `MongoFacetStage`, `MongoGraphLookupStage`, `MongoMergeStage` — AST classes, visitor methods, rewrite (recurse into nested pipelines and expressions), lowering, tests, exports
- [ ] Add window/time-series stages: `MongoSetWindowFieldsStage`, `MongoDensifyStage`, `MongoFillStage` — AST classes, visitor methods, rewrite, lowering, tests, exports
- [ ] Add Atlas-specific stages: `MongoSearchStage`, `MongoSearchMetaStage`, `MongoVectorSearchStage` — AST classes (opaque config), visitor methods, rewrite (identity — config is passed through), lowering, tests, exports
- [ ] Eliminate `AggregatePipelineEntry` — change `AggregateCommand.pipeline` to `ReadonlyArray<MongoPipelineStage>`, remove `isTypedStage()`, remove raw pass-through branch in `lowerPipeline()`, update any tests that used `Record<string, unknown>` pipeline entries
- [ ] Add builder methods on `PipelineBuilder` for new stages: `facet()`, `graphLookup()`, `unionWith()`, `bucket()`, `bucketAuto()`, `out()`, `merge()`, `setWindowFields()`, `geoNear()`, `redact()` — with unit tests for each

### Milestone 2: Pipeline-style updates (computed writes)

Add pipeline-style update support to write commands. This enables computed writes — setting fields based on other fields, conditional logic, cross-field arithmetic — capabilities that traditional `$set`/`$inc` operators cannot express.

**Validation:** Update commands accept aggregation pipeline arrays alongside traditional operator documents. Adapter correctly lowers both forms. Existing ORM write operations are unaffected.

**Tasks:**

- [ ] Add `MongoUpdatePipelineStage` and `MongoUpdateSpec` types in `commands.ts`
- [ ] Update `UpdateOneCommand`, `UpdateManyCommand`, `FindOneAndUpdateCommand` to accept `MongoUpdateSpec` instead of `Record<string, MongoValue>`
- [ ] Update adapter lowering: detect pipeline-style updates (array) and lower each stage via `lowerStage()`; traditional updates continue through `resolveDocument()`
- [ ] Tests: command construction with both update forms, adapter lowering for both forms, type-level tests ensuring existing ORM code still compiles

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---------------------|-----------|-----------|-------|
| All 14 new stages have AST classes with `kind`, `accept()`, `rewrite()` | Unit | M1 | Construction, frozen, rewrite with/without expressions, visitor dispatch |
| `lowerStage()` handles all 28 stage kinds | Unit | M1 | Lowering test per new stage kind |
| `AggregatePipelineEntry` removed, no `Record<string, unknown>` in pipeline | Type-level | M1 | `@ts-expect-error` test: raw object not assignable to `MongoPipelineStage` pipeline |
| `MongoStageVisitor<R>` exhaustive for all 28 kinds | Type-level | M1 | Existing exhaustive visitor test covers this implicitly |
| Update commands accept `MongoUpdateSpec` | Unit | M2 | Construct with both traditional and pipeline-style updates |
| Adapter lowers pipeline-style updates via `lowerStage()` | Unit | M2 | Lowering test with pipeline-style update produces array of lowered stages |
| Adapter lowers traditional updates unchanged | Unit | M2 | Existing lowering tests pass without modification |
| Builder methods produce correct AST nodes | Unit | M1 | Each builder method tested for correct stage class and field values |

## Open Items

- **`$setWindowFields` type-level shape tracking.** Window functions add computed fields to the shape (like `$addFields`). Precise type-level tracking for the window specification is complex. Initial builder method may use shape-preserving semantics; precise tracking can follow.
- **`$facet` type-level shape tracking.** Each facet produces an independent sub-pipeline with its own output shape. The result shape is `{ [facetName]: SubPipelineRow[] }`. This requires each callback to independently track its output shape. Initial builder method may accept typed sub-pipelines but use a simplified output type.
- **Atlas stage config typing.** `MongoSearchStage`, `MongoSearchMetaStage`, and `MongoVectorSearchStage` use opaque `Record<string, unknown>` for their config/query fields. Atlas Search operators form a complex, independently-versioned query language. Typed Atlas Search config is out of scope.
