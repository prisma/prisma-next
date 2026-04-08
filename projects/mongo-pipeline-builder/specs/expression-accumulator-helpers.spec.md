# Summary

Expand the pipeline builder's `fn` (expression) and `acc` (accumulator) helpers to cover the full MongoDB aggregation operator set, and extend the AST to support named-argument operators natively.

# Description

TML-2211 shipped the pipeline builder with a starter set of typed expression helpers (arithmetic, `$concat`, `$cond`, `$literal`, `$toLower`/`$toUpper`, `$size`) and accumulator helpers (`sum`, `avg`, `min`, `max`, `first`, `last`, `push`, `addToSet`, `count`). This ticket fills in the long tail: date, string, array, set, type, object, and comparison expression operators; additional accumulators (`$stdDevPop`, `$stdDevSamp`, `$topN`, `$firstN`, etc.).

Many of the missing operators use **named arguments** (e.g. `{ $dateToString: { format: "...", date: <expr> } }`) rather than the positional form the AST currently supports. Rather than working around this limitation, we extend `MongoAggOperator` and `MongoAggAccumulator` to support named arguments natively, keeping the AST fully traversable by visitors and rewriters.

**Linear:** [TML-2217](https://linear.app/prisma-company/issue/TML-2217)
**Parent spec:** [projects/mongo-pipeline-builder/spec.md](../spec.md)

# Requirements

## Functional Requirements

### AST: Named-argument support for operators and accumulators

- `MongoAggOperator.args` is widened from `MongoAggExpr | ReadonlyArray<MongoAggExpr>` to `MongoAggExpr | ReadonlyArray<MongoAggExpr> | Readonly<Record<string, MongoAggExpr>>`
- `MongoAggAccumulator.arg` is widened from `MongoAggExpr | null` to `MongoAggExpr | Readonly<Record<string, MongoAggExpr>> | null`
- `rewrite()` on both classes recurses into record-form args
- Adapter lowering handles the record form: each value is lowered via `lowerAggExpr()`, producing `{ [op]: { key1: lowered, key2: lowered } }`
- Scalar options (format strings, unit names, sort specs) are wrapped as `MongoAggLiteral` values within the named-args record

### Expression helpers: date operators

`$year`, `$month`, `$dayOfMonth`, `$hour`, `$minute`, `$second`, `$millisecond`, `$dateToString`, `$dateFromString`, `$dateDiff`, `$dateAdd`, `$dateSubtract`, `$dateTrunc`

- Date-part extraction operators (`$year`, `$month`, etc.) return `NumericField`
- `$dateToString` returns `StringField`
- `$dateFromString`, `$dateAdd`, `$dateSubtract`, `$dateTrunc` return `DateField`
- `$dateDiff` returns `NumericField`
- Named-args operators use the record form on `MongoAggOperator`

### Expression helpers: string operators

`$substr`, `$substrBytes`, `$trim`, `$ltrim`, `$rtrim`, `$split`, `$strLenCP`, `$strLenBytes`, `$regexMatch`, `$regexFind`, `$regexFindAll`, `$replaceOne`, `$replaceAll`

- `$substr`, `$substrBytes`, `$trim`, `$ltrim`, `$rtrim`, `$replaceOne`, `$replaceAll` return `StringField`
- `$split` returns `ArrayField`
- `$strLenCP`, `$strLenBytes` return `NumericField`
- `$regexMatch` returns `BooleanField`
- `$regexFind` returns `DocField` (result document)
- `$regexFindAll` returns `ArrayField`

### Expression helpers: array operators

`$arrayElemAt`, `$concatArrays`, `$first` (array), `$last` (array), `$in`, `$indexOfArray`, `$isArray`, `$reverseArray`, `$slice`, `$zip`, `$range`

- `$arrayElemAt`, `$first`, `$last` return `DocField` (element type unknown without generics on arrays)
- `$concatArrays`, `$reverseArray`, `$slice`, `$zip` return `ArrayField`
- `$in`, `$isArray` return `BooleanField`
- `$indexOfArray` returns `NumericField`
- `$range` returns `ArrayField`

### Expression helpers: set operators

`$setUnion`, `$setIntersection`, `$setDifference`, `$setEquals`, `$setIsSubset`, `$anyElementTrue`, `$allElementsTrue`

- `$setUnion`, `$setIntersection`, `$setDifference` return `ArrayField`
- `$setEquals`, `$setIsSubset`, `$anyElementTrue`, `$allElementsTrue` return `BooleanField`

### Expression helpers: type operators

`$type`, `$convert`, `$toInt`, `$toLong`, `$toDouble`, `$toDecimal`, `$toString`, `$toObjectId`, `$toBool`, `$toDate`

- `$type` returns `StringField`
- `$convert` returns `DocField` (output type depends on `to` parameter, not statically known)
- `$toInt`, `$toLong`, `$toDouble`, `$toDecimal` return `NumericField`
- `$toString` returns `StringField`
- `$toObjectId` returns `DocField` (ObjectId codec)
- `$toBool` returns `BooleanField`
- `$toDate` returns `DateField`

### Expression helpers: object operators

`$objectToArray`, `$arrayToObject`, `$getField`, `$setField`

- `$objectToArray` returns `ArrayField`
- `$arrayToObject` returns `DocField`
- `$getField` returns `DocField`
- `$setField` returns `DocField`

### Expression helpers: comparison operators (aggregation expression forms)

`$cmp`, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`

- `$cmp` returns `NumericField` (-1, 0, or 1)
- `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte` return `BooleanField`

### Accumulator helpers

`$stdDevPop`, `$stdDevSamp`, `$bottom`, `$top`, `$bottomN`, `$topN`, `$firstN`, `$lastN`, `$maxN`, `$minN`

- `$stdDevPop`, `$stdDevSamp` take a single expression, return `NullableNumericField`
- `$firstN`, `$lastN`, `$maxN`, `$minN` take `{ input, n }` (named args on accumulator), return `ArrayField`
- `$top`, `$bottom` take `{ output, sortBy }` (named args), return `DocField`
- `$topN`, `$bottomN` take `{ output, sortBy, n }` (named args), return `ArrayField`

### New field types

- `BooleanField = { readonly codecId: 'mongo/bool@1'; readonly nullable: false }`
- `DateField = { readonly codecId: 'mongo/date@1'; readonly nullable: false }`

## Non-Functional Requirements

- All helpers have type tests (`.test-d.ts`) verifying the `TypedAggExpr<F>` output type
- No `any` types, `@ts-expect-error` (outside negative type tests), or `@ts-nocheck`
- Named-args operators participate fully in AST rewriting (visitor/rewriter can traverse into record args)
- Expression helper namespace stays flat (`fn.year()`, `fn.substr()`, not nested)
- Zero breaking changes to existing `fn` and `acc` APIs
- Lowering tests for named-args operators verify correct MongoDB document structure

## Non-goals

- `$accumulator` (custom JavaScript accumulator) — advanced feature, not planned
- New dedicated AST node classes for named-args operators — the generic `MongoAggOperator` with record args suffices
- Removing existing dedicated AST nodes (`MongoAggArrayFilter`, `MongoAggMap`, `MongoAggReduce`, `MongoAggLet`) — they serve a purpose (variable binding semantics) and remain as-is

## Known gaps

None. All originally-identified gaps have been addressed:
- `fn.literal` now uses overloaded signatures and `LiteralValue<F>` to constrain values to match their field type.
- `acc.sum` is now generic, preserving the input field's codec type.

# Acceptance Criteria

### AST changes
- [x] `MongoAggOperator` accepts `Readonly<Record<string, MongoAggExpr>>` as args
- [x] `MongoAggAccumulator` accepts `Readonly<Record<string, MongoAggExpr>>` as arg
- [x] `rewrite()` recurses into record-form args on both classes
- [x] Adapter lowering produces `{ [op]: { key: lowered, ... } }` for record-form args
- [x] Lowering tests cover all three arg forms (single, array, record) for operators and both forms (single, record) for accumulators

### Expression helpers
- [x] All 13 date helpers exist on `fn` with correct return types
- [x] All 13 string helpers exist on `fn` with correct return types
- [x] All 11 array helpers exist on `fn` with correct return types
- [x] All 7 set helpers exist on `fn` with correct return types
- [x] All 10 type helpers exist on `fn` with correct return types
- [x] All 4 object helpers exist on `fn` with correct return types
- [x] All 7 comparison helpers exist on `fn` with correct return types
- [x] Type tests verify `TypedAggExpr<F>` output type for every new helper

### Accumulator helpers
- [x] `stdDevPop` and `stdDevSamp` exist on `acc` with `NullableNumericField` return
- [x] `firstN`, `lastN`, `maxN`, `minN` exist on `acc` with named args and `ArrayField` return
- [x] `top`, `bottom`, `topN`, `bottomN` exist on `acc` with named args
- [x] Type tests verify `TypedAccumulatorExpr<F>` output type for every new helper

### Backward compatibility
- [x] All existing expression helper tests pass unchanged
- [x] All existing accumulator helper tests pass unchanged
- [x] All existing builder tests pass unchanged
- [x] All existing lowering tests pass unchanged

# Other Considerations

## Security

No security implications. Pipeline stages are constructed as typed AST nodes, not raw strings.

## Cost

No infrastructure cost. This is compile-time/build-time library code.

## Observability

No observability changes. The helpers produce the same `MongoQueryPlan` structures as before.

## Data Protection

No change from existing data access patterns.

# References

- [MongoDB aggregation expression operators](https://www.mongodb.com/docs/manual/reference/operator/aggregation/)
- [Pipeline builder task plan](../plans/pipeline-builder-plan.md)
- [Parent project spec](../spec.md)
- [TML-2217](https://linear.app/prisma-company/issue/TML-2217)

# Resolved Questions

1. ~~**Namespace structure**~~ — Flat. `fn.year()`, `fn.substr()`, not `fn.date.year()`.
2. ~~**Scope**~~ — All operators listed in the Linear ticket, except `$accumulator` (custom JS).
3. ~~**Named-args operator representation**~~ — Extend `MongoAggOperator` and `MongoAggAccumulator` to support `Record<string, MongoAggExpr>` as args. Scalar options wrapped as `MongoAggLiteral`.
4. ~~**Accumulator precision refinement**~~ — Addressed. `acc.sum` is now generic, preserving the input field's codec type.
