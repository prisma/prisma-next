# Code Review — Remaining Stages, Pipeline-Style Updates & Cleanup

**Spec:** [remaining-stages-pipeline-style-updates.spec.md](../remaining-stages-pipeline-style-updates.spec.md)
**Branch:** `tml-2212-remaining-stages-pipeline-style-updates-cleanup`
**Base:** `origin/main`
**Review range:** `origin/main...HEAD` (6 commits)

## Summary

Clean, well-structured extension of the MongoDB query AST that adds 14 new pipeline stage classes, eliminates the untyped escape hatch, introduces pipeline-style update support, and adds builder methods — all following established patterns consistently. A few test coverage gaps and minor issues are noted below.

## What Looks Solid

- **Consistent pattern adherence.** Every new stage class follows the established `MongoStageNode` contract exactly: `kind` discriminant, `accept()`, `rewrite()`, `freeze()`, and shallow-frozen array/record fields. The mechanical consistency makes the 600+ lines of new stage code easy to trust.
- **Strong type-level safety.** The `stages.test-d.ts` file is excellent — it verifies the 28-member kind union, exhaustive switch, visitor completeness, and that raw objects are rejected. This is the right way to lock in the invariants.
- **Clean elimination of `AggregatePipelineEntry`.** The `isTypedStage()` guard and raw pass-through are gone. `lowerPipeline()` becomes a one-liner. The removal is complete — grep confirms no references remain.
- **Well-scoped pipeline-style updates.** The `MongoUpdateSpec` / `MongoUpdatePipelineStage` types are minimal and correct. The adapter's `lowerUpdate()` helper is clean.
- **Builder methods make appropriate shape trade-offs.** Complex stages use opaque `DocShape`; simple stages preserve the current `Shape`. The non-goals explicitly defer precise shape tracking for `$facet` and `$setWindowFields`.
- **Comprehensive lowering tests.** Every new stage kind has a lowering test, including edge cases like `$out` with/without `db`, `$merge` with string vs pipeline `whenMatched`, and `$geoNear` with/without `query`.
- **Commit history is well-structured.** 6 focused commits following a logical progression: rename → AST classes → eliminate escape hatch → pipeline-style updates → builder methods. Each commit is independently reviewable.

## Findings

### F01 — `MongoBucketStage.rewrite()` / `MongoBucketAutoStage.rewrite()`: no test for `output` accumulator rewriting

- **Location:** [packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts](packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts) — lines 335–409
- **Issue:** Both `MongoBucketStage` and `MongoBucketAutoStage` have `rewrite()` paths that call `rewriteAccumulatorRecord(this.output, rewriter)` when `output` is provided. The existing tests only construct stages *without* `output`, so the accumulator-rewriting path is untested.
- **Suggestion:** Add rewrite tests that construct a `MongoBucketStage` with `output: { count: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')) }` and verify the accumulator's arg field ref is rewritten.

### F02 — `MongoGraphLookupStage.rewrite()`: no test for `restrictSearchWithMatch` rewriting

- **Location:** [packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts](packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts) — lines 482–530
- **Issue:** `MongoGraphLookupStage.rewrite()` has a path that rewrites `restrictSearchWithMatch` via `context.filter`. The test at line 507 only tests `startWith` rewriting via `aggExpr`. The filter-rewriting path for `restrictSearchWithMatch` is untested at the AST level. (There is a lowering test covering `restrictSearchWithMatch` in the lowering file, but that tests lowering, not rewrite recursion.)
- **Suggestion:** Add a test that constructs a `MongoGraphLookupStage` with `restrictSearchWithMatch: MongoFieldFilter.eq(...)` and a `filter` rewriter context, then verify the rewritten stage has a different `restrictSearchWithMatch`.

### F03 — `MongoGeoNearStage.rewrite()`: rewrite test uses a non-standard filter rewriter

- **Location:** [packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts](packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts) — lines 429–448
- **Issue:** The `$geoNear` rewrite test at line 430 constructs a filter rewriter as `{ field: () => MongoFieldFilter.eq('rewritten', true) }`. This creates a `MongoFilterRewriter` that replaces every `MongoFieldFilter` with a hardcoded value. The test then only asserts `rewritten.query` is defined and `rewritten !== stage` — it doesn't verify the *content* of the rewritten query. This is weaker evidence than the other rewrite tests, which verify the rewritten content (e.g., field path).
- **Suggestion:** Assert that the rewritten query's field or value matches what the filter rewriter produces.

### F04 — `MongoBucketStage.output` lowering uses `lowerExprRecord` but output values are accumulators

- **Location:** [packages/3-mongo-target/2-mongo-adapter/src/lowering.ts](packages/3-mongo-target/2-mongo-adapter/src/lowering.ts) — line 259
- **Issue:** `lowerExprRecord` is called on `stage.output` for `$bucket`, which has type `Record<string, MongoAggAccumulator>`. `lowerExprRecord` calls `lowerAggExpr(val)` on each entry. Since `MongoAggAccumulator` extends `MongoAggExpr` (and has an `accept()` method that dispatches to `aggExprLoweringVisitor.accumulator`), this works correctly at runtime. However, the function name `lowerExprRecord` doesn't clearly communicate that it handles accumulators. The same pattern is used for `$bucketAuto.output` (line 267). This is a readability nit — the code is correct; the function is generic enough for both expressions and accumulators.
- **Suggestion:** No change needed. The function works because `MongoAggAccumulator` is a subtype of `MongoAggExpr`. If naming ever becomes confusing, it could be renamed, but that's cosmetic.

### F05 — `MongoMergeStage.into` as object: frozen object not verified in rewrite round-trip

- **Location:** [packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts](packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts) — lines 532–563
- **Issue:** The test at line 539 verifies `into` as an object is stored, and line 545 verifies `isFrozen(stage)`. But the `rewrite()` test at line 554 uses `into: 'output'` (string form). There's no test verifying that `rewrite()` with object `into` preserves the frozen object correctly. The implementation creates a new stage with the same `this.into` reference, which would be frozen from the original construction, so it's correct — but the test gap means a future regression could go unnoticed.
- **Suggestion:** Add a test that rewrites a `MongoMergeStage` with `into: { db: 'archive', coll: 'results' }` and verifies the rewritten stage's `into` matches.

### F06 — `MongoVectorSearchStage.filter` is `Record<string, unknown>` (not `MongoFilterExpr`)

- **Location:** [packages/2-mongo-family/4-query/query-ast/src/stages.ts](packages/2-mongo-family/4-query/query-ast/src/stages.ts) — line 947
- **Issue:** The spec lists `filter?` for `$vectorSearch`. The implementation uses `Readonly<Record<string, unknown>>`, which means the filter expression inside `$vectorSearch` cannot be rewritten or lowered through the normal filter infrastructure. The `rewrite()` method returns `this` without recursing into the filter. This is intentional (per the spec: "Atlas stages use opaque config") and consistent with `$search` / `$searchMeta`, but worth noting — if users compose `MongoFilterExpr` nodes inside `$vectorSearch`, those nodes won't be lowered. The lowering for `$vectorSearch` does `{ ...stage.filter }` (shallow copy), which is appropriate for the opaque model.
- **Suggestion:** No change needed for this PR. The non-goal for Atlas stage config typing is documented in the spec. If/when Atlas Search filter support is needed, this would need revisiting.

### F07 — Pipeline builder `build()` row types are not verified end-to-end; no type test covers `execute()` output

- **Location:** [packages/2-mongo-family/5-query-builders/pipeline-builder/test/builder.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/builder.test-d.ts) — lines 11–14
- **Issue:** The existing type test only checks `expectTypeOf(plan).toMatchTypeOf<MongoQueryPlan>()` — the default `Row = unknown` parameter. It never asserts that `build()` carries a specific `Row` type, or that `MongoRuntime.execute(plan)` returns typed rows. Consequently, there is no compile-time guard that the pipeline DSL's type-safety promise actually holds at the point a user consumes query results. The demo app (`examples/mongo-demo/src/server.ts`) confirms that `(await runtime.execute(plan))[0].author` resolves to `unknown` — all row fields are untyped.
- **Severity:** High — this is the core value proposition of a "type-safe aggregation pipeline DSL". Without a type test anchoring the `build()` → `execute()` → typed result contract, the type flow can silently break (and has).
- **Suggestion:** Add type-level tests in `builder.test-d.ts` that:
  1. Assert `build()` produces `MongoQueryPlan<{ _id: string; total: number; ... }>` (not just `MongoQueryPlan`).
  2. Assert `runtime.execute(plan)` returns `AsyncIterableResult<{ _id: string; ... }>`.
  3. Assert that post-`group`, post-`addFields`, and post-`lookup` shapes resolve to concrete field types (not `unknown`).

## Deferred (Out of Scope)

### D01 — `unknown` types on `MongoBucketStage.boundaries`, `MongoBucketStage.default_`, `MongoGeoNearStage.near`

These fields use `unknown` because MongoDB accepts heterogeneous boundary arrays, arbitrary default values, and both GeoJSON objects and legacy coordinate pairs. Typing these more precisely would require either a `MongoValue` constraint or separate GeoJSON types — work that belongs in a targeted follow-up (or may be unnecessary if these stages are primarily used via `pipe()`).

### D02 — Window field operator lowering assumes accumulator-shaped output

`lowerWindowField()` casts the result of `lowerAggExpr(wf.operator)` as `Record<string, unknown>` and then adds a `window` property to it. This works for `$sum`, `$avg`, etc. (which lower to `{ $sum: ... }`), but could break for non-accumulator operators used as window functions. This is an edge case that depends on how the builder/user constructs window field operators and is better addressed when window function usage is expanded.

## Already Addressed

### F01 — `MongoBucketStage.rewrite()` / `MongoBucketAutoStage.rewrite()`: output accumulator rewriting now tested

Added rewrite tests that construct stages with `output` accumulators and verify the accumulator's field ref is rewritten.

### F02 — `MongoGraphLookupStage.rewrite()`: `restrictSearchWithMatch` rewriting now tested

Added a test that constructs a `MongoGraphLookupStage` with `restrictSearchWithMatch: MongoFieldFilter.eq(...)` and a `filter` rewriter, verifying the rewritten stage has the expected filter content.

### F03 — `MongoGeoNearStage.rewrite()`: rewrite test now verifies content

Strengthened the test to assert on the rewritten query's field and value, not just that it's defined and a different reference.

### F05 — `MongoMergeStage.rewrite()` with object `into` now tested

Added a test that rewrites a `MongoMergeStage` with `into: { db: 'archive', coll: 'results' }` and verifies the rewritten stage preserves the object `into`.

## Acceptance-Criteria Traceability

| Acceptance Criterion | Implementation | Evidence |
|---------------------|----------------|----------|
| `MongoReadStage` renamed to `MongoPipelineStage` — no old references remain | [packages/2-mongo-family/4-query/query-ast/src/stages.ts](packages/2-mongo-family/4-query/query-ast/src/stages.ts) — line 976 | `rg MongoReadStage` returns 0 matches |
| All 14 remaining stages have typed AST classes | [packages/2-mongo-family/4-query/query-ast/src/stages.ts](packages/2-mongo-family/4-query/query-ast/src/stages.ts) — lines 403–1004 | [packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts](packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts) — 115 tests |
| `MongoStageVisitor<R>` has methods for all 28 kinds | [packages/2-mongo-family/4-query/query-ast/src/visitors.ts](packages/2-mongo-family/4-query/query-ast/src/visitors.ts) — lines 106–135 | [packages/2-mongo-family/4-query/query-ast/test/stages.test-d.ts](packages/2-mongo-family/4-query/query-ast/test/stages.test-d.ts) — lines 169–217 |
| `lowerStage()` handles all 28 kinds (exhaustive) | [packages/3-mongo-target/2-mongo-adapter/src/lowering.ts](packages/3-mongo-target/2-mongo-adapter/src/lowering.ts) — lines 183–377 | [packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts](packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts) — lines 592–872 |
| `AggregatePipelineEntry` removed | [packages/2-mongo-family/4-query/query-ast/src/commands.ts](packages/2-mongo-family/4-query/query-ast/src/commands.ts) — lines 135–146 | `rg AggregatePipelineEntry` returns 0 matches |
| `isTypedStage()` and raw pass-through removed | [packages/3-mongo-target/2-mongo-adapter/src/lowering.ts](packages/3-mongo-target/2-mongo-adapter/src/lowering.ts) — lines 380–384 | `rg isTypedStage` returns 0 matches |
| Each new stage has unit tests | [packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts](packages/2-mongo-family/4-query/query-ast/test/stages-extended.test.ts) | 115 tests covering construction, frozen, rewrite, visitor |
| Each new stage has lowering tests | [packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts](packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts) — lines 592–872 | 22 lowering tests for new stages |
| `MongoUpdateSpec` type exists | [packages/2-mongo-family/4-query/query-ast/src/commands.ts](packages/2-mongo-family/4-query/query-ast/src/commands.ts) — line 16 | Type-level: exported in index.ts |
| Update commands accept `MongoUpdateSpec` | [packages/2-mongo-family/4-query/query-ast/src/commands.ts](packages/2-mongo-family/4-query/query-ast/src/commands.ts) — lines 31–119 | [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — lines 79–113 |
| Adapter lowers pipeline-style updates | [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts](packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts) — lines 27–31 | [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — lines 79–113 |
| Adapter lowers traditional updates unchanged | [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts](packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts) — lines 27–31 | [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — lines 69–77, 173–184 |
| Builder has typed methods for 10 new stages | [packages/2-mongo-family/5-query-builders/pipeline-builder/src/builder.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/builder.ts) — lines 254–396 | [packages/2-mongo-family/5-query-builders/pipeline-builder/test/builder.test.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/builder.test.ts) — lines 308–518 |
| Each builder method has unit tests | [packages/2-mongo-family/5-query-builders/pipeline-builder/test/builder.test.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/builder.test.ts) — lines 308–518 | 18 tests for new builder methods |
| Raw objects not assignable to `MongoPipelineStage` | [packages/2-mongo-family/4-query/query-ast/test/stages.test-d.ts](packages/2-mongo-family/4-query/query-ast/test/stages.test-d.ts) — lines 272–275 | `@ts-expect-error` test |
