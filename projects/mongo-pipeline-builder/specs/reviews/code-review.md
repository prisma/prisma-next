# Code Review — TML-2217: Complete Typed Expression and Accumulator Helpers

**Spec:** [expression-accumulator-helpers.spec.md](../expression-accumulator-helpers.spec.md)
**Branch:** `tml-2217-complete-typed-expression-and-accumulator-helpers-for`
**Base:** `origin/main`
**Commit range:** `origin/main..HEAD` (10 commits, 21 files, +1566 −82)

## Summary

This branch extends the MongoDB pipeline builder's `fn` and `acc` helpers to cover the full aggregation operator set (~65 expression helpers, ~10 accumulator helpers). It first widens the AST to support named-argument operators, then adds helpers by category with comprehensive type tests. The implementation is clean, idiomatic, and well-structured.

## What Looks Solid

- **AST widening** is minimal and correct. The `isRecordArgs` type guard, constructor freezing, and rewrite recursion all follow established patterns.
- **Factory function pattern** in `expression-helpers.ts` is excellent — reduces ~65 helpers to one-liners that delegate to well-tested factories.
- **Type test coverage** is thorough. Every new helper has a corresponding `expectTypeOf` test verifying its return type.
- **Lowering** is updated correctly with tests for both record-arg operators and accumulators.
- **Backward compatibility** is preserved — existing tests pass unchanged, type widening is additive.
- **Documentation** — README.md and DEVELOPING.md are updated with full helper reference tables and the named-args design.
- **Naming collision resolution** is pragmatic: `isIn`, `typeOf`, `toString_`, `firstElem`/`lastElem`.

## Findings

### ~~F01 — Named-args helpers accept untyped record keys and untyped values~~ ✅ Addressed

Resolved by narrowing all ~20 named-args expression and accumulator helper signatures to use specific record types with per-key field type constraints. Typos, missing required keys, extra keys, and wrong value types are now caught at compile time. Negative type tests verify rejection of wrong-type arguments.

### ~~F02 — Duplicated type guards across packages~~ ✅ Addressed

Resolved in `735720a`. `isRecordArgs`, `isExprArray`, and `AggRecordArgs` are now exported from `@prisma-next/mongo-query-ast`'s public API. The lowering module imports them instead of duplicating the logic.

### ~~F03 — No runtime tests for new expression/accumulator helpers~~ ✅ Addressed

Resolved in `ad2b994`. Comprehensive parameterized runtime tests added:

- [expression-helpers.test.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test.ts) — 122 lines, covers all ~65 helpers across three categories (unary, positional multi-arg, named-args). Verifies op name, arg form (array vs record), and key names for named-args.
- [accumulator-helpers.test.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/accumulator-helpers.test.ts) — 46 lines, covers `stdDevPop`/`stdDevSamp` and all 8 named-args accumulators. Verifies op name, record arg form, and key names.

### ~~F04 — No integration/e2e tests for new helpers against a real MongoDB~~ ✅ Addressed

Resolved in `f72990e`. Four integration tests added to [pipeline-builder.test.ts](test/integration/test/mongo/pipeline-builder.test.ts) covering the representative sample:

1. `fn.dateToString` — named-args date expression, formats `createdAt` and verifies `'2024-01-15'`
2. `fn.trim` — named-args string expression, verifies whitespace removal
3. `fn.gt` in a `$cond` — positional comparison expression driving conditional output
4. `acc.firstN` — named-args accumulator in a `$group`, verifies first-N per group

Test contract and seed data extended with `createdAt: Date` field and `mongo/date@1` + `mongo/bool@1` codec types.

### ~~F05 — `docUnaryExpr` hardcodes `nullable: false` for potentially nullable results~~ ✅ Addressed

Resolved by introducing `NullableDocField` type alias and `nullableDocUnaryExpr` factory. `firstElem`, `lastElem`, and `arrayElemAt` now correctly return `TypedAggExpr<NullableDocField>`, reflecting that these operators can return null when the array is empty or the index is out of bounds.

## Already Addressed

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| F01 / D01 | Named-args helpers accept untyped record keys and values | Fixed | All ~20 named-args expression and accumulator helpers now use specific record types with per-key field type constraints (e.g. `date: TypedAggExpr<DateField>`, `n: TypedAggExpr<NumericField>`). Negative type tests verify wrong-type arguments are rejected at compile time. |
| F02 | Duplicated type guards across packages | Fixed | Exported `isRecordArgs`, `isExprArray`, `AggRecordArgs` from query-ast public API; removed duplicates from lowering.ts |
| F03 | No runtime tests for new expression/accumulator helpers | Fixed | Added parameterized runtime tests (73 expression + 10 accumulator) verifying correct `$op` strings and argument shapes |
| F04 | No integration/e2e tests for new helpers against real MongoDB | Fixed | Added 4 representative integration tests: `fn.dateToString`, `fn.trim`, `fn.gt` in `$cond`, `acc.firstN` |
| F05 / D02 | `docUnaryExpr` hardcodes `nullable: false` for nullable results | Fixed | Added `NullableDocField` type alias, `nullableDocUnaryExpr` factory. `firstElem`, `lastElem`, and `arrayElemAt` now return `TypedAggExpr<NullableDocField>`. |

## Acceptance-Criteria Traceability

### AST changes

| Criterion | Implementation | Evidence |
|---|---|---|
| `MongoAggOperator` accepts record args | [aggregation-expressions.ts](packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts) — lines 83–96 | [aggregation-expressions.test.ts](packages/2-mongo-family/4-query/query-ast/test/aggregation-expressions.test.ts) — "constructs with record args", "freezes record args"; [aggregation-expressions.test-d.ts](packages/2-mongo-family/4-query/query-ast/test/aggregation-expressions.test-d.ts) — "MongoAggOperator.args accepts all three forms" |
| `MongoAggAccumulator` accepts record arg | [aggregation-expressions.ts](packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts) — lines 159–169 | [aggregation-expressions.test.ts](packages/2-mongo-family/4-query/query-ast/test/aggregation-expressions.test.ts) — "constructs with record arg", "freezes record arg"; [aggregation-expressions.test-d.ts](packages/2-mongo-family/4-query/query-ast/test/aggregation-expressions.test-d.ts) — "MongoAggAccumulator.arg accepts MongoAggExpr, record, or null" |
| `rewrite()` recurses into record args | [aggregation-expressions.ts](packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts) — lines 141–153, 224–235 | [aggregation-expressions.test.ts](packages/2-mongo-family/4-query/query-ast/test/aggregation-expressions.test.ts) — "rewrites record-arg operator children", "rewrites record-arg accumulator children" |
| Lowering produces correct docs for record args | [lowering.ts](packages/3-mongo-target/2-mongo-adapter/src/lowering.ts) — lines 52–73 | [lowering.test.ts](packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts) — "lowers record-arg operator", "lowers record-arg accumulator" |

### Expression helpers

| Criterion | Implementation | Evidence |
|---|---|---|
| 13 date helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 180–218 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "date helpers" describe block |
| 13 string helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 222–268 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "string helpers" describe block |
| 7 comparison helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 272–292 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "comparison helpers" describe block |
| 11 array helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 296–336 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "array helpers" describe block |
| 7 set helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 340–360 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "set helpers" describe block |
| 10 type helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 364–393 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "type helpers" describe block |
| 4 object helpers with correct return types | [expression-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/expression-helpers.ts) — lines 397–408 | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) — "object helpers" describe block |
| Type tests for every new helper | [expression-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/expression-helpers.test-d.ts) (243 lines) | All 65 helpers have `expectTypeOf` assertions |

### Accumulator helpers

| Criterion | Implementation | Evidence |
|---|---|---|
| `stdDevPop` and `stdDevSamp` with `NullableNumericField` | [accumulator-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/accumulator-helpers.ts) — lines 67–73; [aggregation-expressions.ts](packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts) — lines 212–218 | [accumulator-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/accumulator-helpers.test-d.ts) — lines 14–19 |
| `firstN`, `lastN`, `maxN`, `minN` with named args and `ArrayField` | [accumulator-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/accumulator-helpers.ts) — lines 75–101 | [accumulator-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/accumulator-helpers.test-d.ts) — lines 22–37 |
| `top`, `bottom`, `topN`, `bottomN` with named args | [accumulator-helpers.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/src/accumulator-helpers.ts) — lines 103–129 | [accumulator-helpers.test-d.ts](packages/2-mongo-family/5-query-builders/pipeline-builder/test/accumulator-helpers.test-d.ts) — lines 38–58 |

### Backward compatibility

| Criterion | Evidence |
|---|---|
| Existing expression helper tests pass unchanged | No modifications to existing test assertions |
| Existing accumulator helper tests pass unchanged | No modifications to existing test assertions |
| Existing builder tests pass unchanged | Not modified in this diff |
| Existing lowering tests pass unchanged | Only additions; no modifications to existing test assertions |
