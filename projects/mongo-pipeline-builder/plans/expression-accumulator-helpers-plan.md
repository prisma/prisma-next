# Complete Typed Expression and Accumulator Helpers — Execution Plan

## Summary

Extend the pipeline builder's typed helpers (`fn` and `acc`) to cover the full MongoDB aggregation operator set (~65 expression helpers, ~10 accumulator helpers). First extend the AST layer to support named-argument operators, then add helpers by category with type tests for each batch.

**Spec:** [specs/expression-accumulator-helpers.spec.md](../specs/expression-accumulator-helpers.spec.md)

**Linear:** [TML-2217](https://linear.app/prisma-company/issue/TML-2217)

## Collaborators

| Role | Person | Context |
|---|---|---|
| Maker | Will | Drives execution |

## Milestones

### Milestone 1: AST named-argument support

Extend `MongoAggOperator` and `MongoAggAccumulator` to accept named arguments (`Record<string, MongoAggExpr>`), with full rewriting, lowering, and test coverage. This is the foundation that unblocks all named-args helpers.

**Validation:** Lowering tests produce correct MongoDB documents for all three operator arg forms and both accumulator arg forms. Rewriting recurses into record args. All existing tests pass unchanged.

**Tasks:**

- [x] 1.1 — Widen `MongoAggOperator.args` type to `MongoAggExpr | ReadonlyArray<MongoAggExpr> | Readonly<Record<string, MongoAggExpr>>`. Update constructor to freeze record args. Update `rewrite()` to recurse into record entries. Update `MongoAggOperator.of()` signature.
- [x] 1.2 — Widen `MongoAggAccumulator.arg` type to `MongoAggExpr | Readonly<Record<string, MongoAggExpr>> | null`. Update constructor, `rewrite()`, and `MongoAggAccumulator.of()`.
- [x] 1.3 — Update adapter lowering (`lowering.ts`): add record-args branch to `operator()` and `accumulator()` visitors. Each record value lowered via `lowerAggExpr()`.
- [x] 1.4 — Tests: unit tests for `MongoAggOperator` with record args (construction, freezing, rewrite). Unit tests for `MongoAggAccumulator` with record args. Lowering tests for all three operator forms and both accumulator forms. Verify existing tests pass unchanged.

### Milestone 2: New field types and expression helper infrastructure

Add `BooleanField` and `DateField` type aliases, and internal factory functions for the new return-type patterns.

**Validation:** Type tests verify the new field types resolve correctly through `ResolveRow`.

**Tasks:**

- [x] 2.1 — Add `BooleanField` and `DateField` type aliases to `types.ts`. Export from package index.
- [x] 2.2 — Add internal factory functions to `expression-helpers.ts`: `booleanExpr(op, args)`, `dateExpr(op, args)`, `numericUnaryExpr(op, arg)`, `namedArgsExpr(op, args, field)` (builds `MongoAggOperator` with record args). These follow the existing `numericExpr`, `stringExpr`, `stringUnaryExpr` patterns.
- [x] 2.3 — Type tests: verify `BooleanField` and `DateField` resolve correctly in `ResolveRow` (boolean → `boolean`, date → `Date`).

### Milestone 3: Expression helpers — date, string, comparison

Add the first batch of expression helpers covering the three most commonly needed categories.

**Validation:** All helpers exist on `fn`, type tests verify output types, lowering produces correct MongoDB documents for named-args operators.

**Tasks:**

- [x] 3.1 — Date helpers: `year`, `month`, `dayOfMonth`, `hour`, `minute`, `second`, `millisecond` (numeric unary), `dateToString` (named args → `StringField`), `dateFromString` (named args → `DateField`), `dateDiff` (named args → `NumericField`), `dateAdd`, `dateSubtract` (named args → `DateField`), `dateTrunc` (named args → `DateField`). Type tests for each.
- [x] 3.2 — String helpers: `substr`, `substrBytes` (positional → `StringField`), `trim`, `ltrim`, `rtrim` (named args → `StringField`), `split` (positional → `ArrayField`), `strLenCP`, `strLenBytes` (unary → `NumericField`), `regexMatch` (named args → `BooleanField`), `regexFind` (named args → `DocField`), `regexFindAll` (named args → `ArrayField`), `replaceOne`, `replaceAll` (named args → `StringField`). Type tests for each.
- [x] 3.3 — Comparison helpers: `cmp` (positional → `NumericField`), `eq`, `ne`, `gt`, `gte`, `lt`, `lte` (positional → `BooleanField`). Type tests for each. Note: these are the aggregation expression forms, distinct from the filter operators.

### Milestone 4: Expression helpers — array, set, type, object

Add the remaining expression helper categories.

**Validation:** All helpers exist on `fn`, type tests verify output types.

**Tasks:**

- [x] 4.1 — Array helpers: `arrayElemAt` (positional → `DocField`), `concatArrays` (positional → `ArrayField`), `firstElem`, `lastElem` (unary → `DocField`; named `firstElem`/`lastElem` to avoid collision with accumulator `first`/`last`), `isIn` (positional → `BooleanField`; named `isIn` to avoid collision with JS keyword), `indexOfArray` (positional → `NumericField`), `isArray` (unary → `BooleanField`), `reverseArray` (unary → `ArrayField`), `slice` (positional → `ArrayField`), `zip` (named args → `ArrayField`), `range` (positional → `ArrayField`). Type tests for each.
- [x] 4.2 — Set helpers: `setUnion`, `setIntersection`, `setDifference` (positional → `ArrayField`), `setEquals`, `setIsSubset` (positional → `BooleanField`), `anyElementTrue`, `allElementsTrue` (unary → `BooleanField`). Type tests for each.
- [x] 4.3 — Type helpers: `typeOf` (unary → `StringField`; named `typeOf` to avoid collision with JS keyword), `convert` (named args → `DocField`), `toInt`, `toLong`, `toDouble`, `toDecimal` (unary → `NumericField`), `toString_` (unary → `StringField`; trailing underscore to avoid collision with `Object.toString`), `toObjectId` (unary → `DocField`), `toBool` (unary → `BooleanField`), `toDate` (unary → `DateField`). Type tests for each.
- [x] 4.4 — Object helpers: `objectToArray` (unary → `ArrayField`), `arrayToObject` (unary → `DocField`), `getField` (named args → `DocField`), `setField` (named args → `DocField`). Type tests for each.

### Milestone 5: Accumulator helpers

Add the remaining accumulator helpers, including those that use named args on the widened `MongoAggAccumulator`.

**Validation:** All helpers exist on `acc`, type tests verify output types, lowering produces correct MongoDB documents for named-args accumulators.

**Tasks:**

- [x] 5.1 — Simple accumulators: `stdDevPop`, `stdDevSamp` (single expression → `NullableNumericField`). Add static methods to `MongoAggAccumulator`. Type tests.
- [x] 5.2 — N-variant accumulators: `firstN`, `lastN`, `maxN`, `minN` (named args `{ input, n }` → `ArrayField`). Type tests.
- [x] 5.3 — Top/bottom accumulators: `top`, `bottom` (named args `{ output, sortBy }` → `DocField`), `topN`, `bottomN` (named args `{ output, sortBy, n }` → `ArrayField`). Type tests.

### Milestone 6: Export wiring and final verification

Wire all new exports, verify all tests pass, and update documentation.

**Validation:** Package exports include all new helpers and types. `pnpm lint:deps` passes. All tests green.

**Tasks:**

- [x] 6.1 — Update `exports/index.ts` to re-export `BooleanField`, `DateField` types.
- [x] 6.2 — Verify all new `fn.*` and `acc.*` helpers are accessible from the package's public API (they are already on the `fn` and `acc` objects, which are exported).
- [x] 6.3 — Run full test suite: `pnpm test` in pipeline-builder, `pnpm test` in query-ast, `pnpm test` in mongo-adapter (lowering). Verify `pnpm lint:deps` passes.
- [x] 6.4 — Update `DEVELOPING.md` and `README.md` for the pipeline-builder package to document the full helper set.

### Close-out

- [ ] Verify all acceptance criteria in the [spec](../specs/expression-accumulator-helpers.spec.md) are met

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `MongoAggOperator` accepts record args | Unit | 1.4 | Construction + freezing |
| `MongoAggAccumulator` accepts record args | Unit | 1.4 | Construction + freezing |
| `rewrite()` recurses into record args | Unit | 1.4 | Both classes |
| Lowering produces correct doc for record-form operator | Unit | 1.4 | `{ [op]: { key: lowered } }` |
| Lowering produces correct doc for record-form accumulator | Unit | 1.4 | `{ [op]: { key: lowered } }` |
| Existing tests pass unchanged | Unit | 1.4 | Backward compat |
| `BooleanField` and `DateField` resolve correctly | Type | 2.3 | Via `ResolveRow` |
| 13 date helpers with correct return types | Type | 3.1 | One test per helper |
| 13 string helpers with correct return types | Type | 3.2 | One test per helper |
| 7 comparison helpers with correct return types | Type | 3.3 | One test per helper |
| 11 array helpers with correct return types | Type | 4.1 | One test per helper |
| 7 set helpers with correct return types | Type | 4.2 | One test per helper |
| 10 type helpers with correct return types | Type | 4.3 | One test per helper |
| 4 object helpers with correct return types | Type | 4.4 | One test per helper |
| `stdDevPop`, `stdDevSamp` accumulators | Type | 5.1 | `NullableNumericField` return |
| `firstN`, `lastN`, `maxN`, `minN` accumulators | Type | 5.2 | Named args + `ArrayField` return |
| `top`, `bottom`, `topN`, `bottomN` accumulators | Type | 5.3 | Named args |
| All existing helper tests pass | Unit | 6.3 | No regressions |
| `pnpm lint:deps` passes | Lint | 6.3 | Layering rules |

## Open Items

1. ~~**Helper naming collisions with JS keywords/builtins.**~~ Resolved. `$in` → `isIn`, `$type` → `typeOf`, `$toString` → `toString_`, `$first`/`$last` (array) → `firstElem`/`lastElem`.
2. **`$accumulator` (custom JS) — not planned.** The custom JavaScript accumulator is out of scope. It takes JS code strings and has a complex options shape.
3. ~~**Accumulator precision refinement.**~~ Addressed — `acc.sum` is now generic, preserving the input field's codec type.
