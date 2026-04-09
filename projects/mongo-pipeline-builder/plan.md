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

### ~~Milestone 1: Raw pipeline API~~ ✅

Delivered by [TML-2208](https://linear.app/prisma-company/issue/TML-2208). `mongoRaw().collection(root).aggregate(pipeline)` ships the raw pipeline API with `RawAggregateCommand`.

### ~~Milestone 2: Aggregation expression AST~~ ✅

Delivered by [TML-2209](https://linear.app/prisma-company/issue/TML-2209). `MongoAggExpr` class hierarchy (11 node types), `MongoAggExprVisitor`/`MongoAggExprRewriter`, `lowerAggExpr()`, and `MongoExprFilter` bridge.

### ~~Milestone 3: Core pipeline stage extensions + `$group` end-to-end~~ ✅

Delivered by [TML-2210](https://linear.app/prisma-company/issue/TML-2210). 7 new stage classes (`MongoGroupStage`, `MongoAddFieldsStage`, `MongoReplaceRootStage`, `MongoCountStage`, `MongoSortByCountStage`, `MongoSampleStage`, `MongoRedactStage`), extended `MongoProjectStage`/`MongoLookupStage`/`MongoUnwindStage`, adapter lowering for all, and integration tests.

### Milestone 4: Pipeline builder with shape tracking ← **current** ([TML-2211](https://linear.app/prisma-company/issue/TML-2211))

Build the fluent `PipelineBuilder<TContract, DocShape>` that tracks document shape transformations at the type level. This is the main user-facing deliverable.

**Design decisions (resolved):**

- **Static builder, no runtime.** The pipeline builder produces `MongoQueryPlan` via `build()`. There is no `execute()` method — the user passes the plan to their runtime separately. No dependency on `@prisma-next/runtime-executor` or `MongoQueryExecutor`.
- **Separate package under restructured `5-query-builders/`.** Move `@prisma-next/mongo-orm` to `5-query-builders/orm/`, create new `@prisma-next/mongo-pipeline-builder` at `5-query-builders/pipeline-builder/`.
- **Entry point:** `mongoPipeline<Contract>({ contractJson }).from('collectionName')` — a one-liner root constructor, analogous to `postgres<Contract>({ contractJson })`. Sufficient for this branch; a convenience function that wires builder + runtime is a later concern.
- **Flat fields only.** `FieldProxy` and `FilterProxy` support top-level field access. Nested/dot-path access (ADR 180) deferred until value objects land.
- **Starter expression helpers.** Arithmetic, `$concat`, `$cond`, `$literal`, `$toLower`/`$toUpper`, `$size`. Full operator coverage is a follow-up: [TML-2217](https://linear.app/prisma-company/issue/TML-2217).
- **Accumulator output types default to `'double'`.** Precision refinement addressed in [TML-2217](https://linear.app/prisma-company/issue/TML-2217) — `acc.sum` is now generic, preserving input codec type.

**Worked example — type safety through shape transformations:**

```typescript
import { mongoPipeline, acc, fn } from '@prisma-next/mongo-pipeline-builder';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const p = mongoPipeline<Contract>({ contractJson });

// Shape starts as Order model fields:
//   { _id: ObjectId, customerId: ObjectId, status: string, amount: number, createdAt: Date }

const plan = p
  .from('orders')

  // match(): identity stage — shape unchanged, FilterProxy gives autocomplete
  .match(f => f.status.eq('completed'))       // ✅ `status` known, `.eq()` accepts string
  // .match(f => f.bogus.eq('x'))             // ❌ compile error: `bogus` not in shape

  // group(): replacement stage — previous shape is discarded entirely
  .group(f => ({
    _id: f.customerId,                        // ✅ field ref from current shape
    total: acc.sum(f.amount),                 // ✅ accumulator wrapping a field ref
    orderCount: acc.count(),
  }))
  // Shape is now: { _id: ObjectId, total: number, orderCount: number }
  // .match(f => f.status.eq('x'))            // ❌ compile error: `status` no longer exists

  // sort(): identity stage on the NEW shape
  .sort({ total: -1 })                        // ✅ `total` is in the grouped shape
  // .sort({ amount: -1 })                    // ❌ compile error: `amount` is gone

  .limit(10)
  .build();
// plan: MongoQueryPlan<{ _id: ObjectId; total: number; orderCount: number }>


// addFields(): additive — new fields appear in the shape alongside existing ones
const plan2 = p
  .from('users')
  // Shape: { _id: ObjectId, firstName: string, lastName: string, email: string }
  .addFields(f => ({
    fullName: fn.concat(f.firstName, fn.literal(' '), f.lastName),
  }))
  // Shape: { _id, firstName, lastName, email, fullName: string }
  .match(f => f.fullName.eq('Alice Smith'))   // ✅ computed field is now in scope
  .project('_id', 'fullName', 'email')        // ✅ narrows to 3 fields
  // .match(f => f.firstName.eq('x'))         // ❌ compile error: `firstName` projected out
  .build();
// plan2: MongoQueryPlan<{ _id: ObjectId; fullName: string; email: string }>
```

Each stage method returns a new `PipelineBuilder<TContract, NewShape>` where `NewShape` reflects the transformation. The type parameter prevents referencing fields that don't exist in the current shape, and `build()` resolves `DocShape` codec metadata into concrete TypeScript types via the contract's type maps.

**Validation:** Type tests verify shape tracking for all transformation categories. Integration tests execute multi-stage pipelines against mongodb-memory-server with full type inference.

**Tasks:**

- [ ] 4.0 — **Restructure `5-query-builders`.** Move `@prisma-next/mongo-orm` to `packages/2-mongo-family/5-query-builders/orm/`. Update workspace config, architecture config globs, and any repo-wide path references. No new code — purely structural.
- [ ] 4.1 — Scaffold `packages/2-mongo-family/5-query-builders/pipeline-builder/` package. `package.json` (`@prisma-next/mongo-pipeline-builder`), `tsconfig.json`, `tsdown.config.ts`, exports, layering config. Dependencies: `@prisma-next/contract`, `@prisma-next/mongo-contract`, `@prisma-next/mongo-query-ast`.
- [ ] 4.2 — Core type machinery: `DocField`, `DocShape`, `ModelToDocShape<Contract, ModelName>`, `ResolveRow<Shape, CodecTypes>`. Type tests verifying contract → DocShape derivation and DocShape → concrete types resolution.
- [ ] 4.3 — `PipelineBuilder<TContract, Shape>` class with immutable state (`PipelineBuilderState`). `cloneState()` pattern. Identity stage methods: `match(filter)`, `sort(spec)`, `limit(n)`, `skip(n)`, `sample(n)`. `build()` → `MongoQueryPlan`. Type tests: shape is unchanged after identity stages.
- [ ] 4.4 — `FieldProxy<Shape>` and `FilterProxy<Shape>`. `match()` callback overload: `match(fn: (fields: FilterProxy<Shape>) => MongoFilterExpr)`. `SortSpec<Shape>` constrained to current shape keys. Type tests and unit tests.
- [ ] 4.5 — `TypedAggExpr<F>` wrapper. `ExpressionHelpers` (starter set: concat, add, subtract, multiply, divide, cond, literal, toLower, toUpper, size). `addFields()` method with `Shape & ExtractDocShape<NewFields>` return type. Type tests: new fields accessible, existing fields preserved.
- [ ] 4.6 — `project()` — both inclusion overload (`project('field1', 'field2')` → `Pick<Shape>`) and computed overload (callback returning `Record<string, 1 | TypedAggExpr>`). Type tests: excluded fields inaccessible, computed fields have correct types.
- [ ] 4.7 — `AccumulatorHelpers` (sum, avg, min, max, first, last, push, addToSet, count). `group()` method with `GroupedDocShape<Spec>` return type. Type tests: previous shape replaced, accumulator output types correct.
- [ ] 4.8 — `unwind()` with `UnwoundShape<Shape, K>` (array → element type). Type tests.
- [ ] 4.9 — `lookup()` (equality form) with foreign collection shape addition. `replaceRoot()` with embedded document navigation. `count()` and `sortByCount()`. Type tests for each.
- [ ] 4.10 — `.pipe(stage)` escape hatch (shape-preserving and shape-asserting overloads). Entry point: `mongoPipeline<Contract>({ contractJson }).from('collection')`.
- [ ] 4.11 — Integration tests against mongodb-memory-server: (a) match → group → sort → limit, (b) addFields → match on computed field, (c) lookup → unwind → project, (d) replaceRoot into embedded document.
- [ ] 4.12 — Export wiring from `@prisma-next/mongo-pipeline-builder` package. Update `pnpm lint:deps` layering config.

### Milestone 5: Remaining stages, pipeline-style updates, cleanup ([TML-2212](https://linear.app/prisma-company/issue/TML-2212))

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

### Follow-up: Complete expression and accumulator helpers ([TML-2217](https://linear.app/prisma-company/issue/TML-2217))

Expand `ExpressionHelpers` and `AccumulatorHelpers` to cover the full MongoDB aggregation operator set. TML-2211 ships with a starter set; this ticket fills in the long tail (date, string, array, set, type, object, comparison operators; additional accumulators; `fn.literal` type safety; `acc.sum` codec preservation).

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
| Builder match/sort/limit produces typed results | Integration + Type | 4.3–4.4, 4.11a | Shape unchanged |
| group() produces replacement DocShape | Type test | 4.7 | Previous fields inaccessible |
| addFields() extends DocShape | Type test | 4.5 | New + existing fields accessible |
| project() narrows DocShape | Type test | 4.6 | Excluded fields inaccessible |
| unwind() replaces array with element type | Type test | 4.8 | Array field → element |
| lookup() adds array field | Type test | 4.9 | Foreign shape as array |
| replaceRoot() replaces entire DocShape | Type test | 4.9 | Embedded doc shape |
| Multi-stage pipeline executes with type inference | Integration | 4.11 | mongodb-memory-server |
| .pipe() escape hatch works | Unit + Type | 4.10 | Shape preserved/asserted |
| build() returns MongoQueryPlan (no execute) | Unit | 4.3 | Static builder |
| AggregatePipelineEntry removed | Compilation | 5.4 | Type deleted, all consumers compile |
| AggregateCommand.pipeline is MongoPipelineStage[] | Compilation | 5.4 | Type change verified |
| MongoReadStage renamed to MongoPipelineStage | Compilation | 5.3 | All imports updated |
| Existing ORM code compiles unchanged | Compilation | 4.0 | Backward compat after restructure |
| computeUpdate with cross-field reference | Integration | 5.8a | Set fullName from parts |
| computeUpdate with conditional logic | Integration | 5.8b | Tier upgrade |
| Traditional updates unchanged | Integration | 5.8c | Backward compat |

## Resolved Items

1. ~~**Builder entry point**~~ — **Resolved.** Separate root constructor: `mongoPipeline<Contract>({ contractJson })`. Not on `MongoOrmClient`. Analogous to `postgres<Contract>({ contractJson })`.
2. ~~**Nested field access in FieldProxy**~~ — **Resolved.** Flat fields only for now. Deep/dot-path access deferred until value objects land (ADR 180).
3. ~~**Expression helper coverage**~~ — **Resolved.** Starter set in TML-2211. Full coverage tracked as [TML-2217](https://linear.app/prisma-company/issue/TML-2217).
4. ~~**Accumulator output type precision**~~ — **Resolved.** `acc.sum` is now generic, preserving input codec type. `avg`/`stdDev*` remain as double (correct for MongoDB).

## Open Items

1. **`$facet` sub-pipeline typing** — Complex type-level work. Basic form in milestone 5; independent shape tracking deferred.
2. **`$lookup` pipeline form typing** — Let bindings + foreign scope in type system. Basic form in milestone 5; full type inference deferred.
3. **Window function type inference** — `$setWindowFields` stage exists in AST (milestone 5) but builder method deferred.
