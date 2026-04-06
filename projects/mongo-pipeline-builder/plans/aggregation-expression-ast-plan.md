# Aggregation Expression AST — Task Plan

**Milestone:** 2 (Aggregation expression AST)
**Linear:** [TML-2209](https://linear.app/prisma-company/issue/TML-2209)
**Parent spec:** [projects/mongo-pipeline-builder/spec.md](../spec.md)
**Parent plan:** [projects/mongo-pipeline-builder/plan.md](../plan.md)
**Design doc:** [projects/orm-consolidation/plans/aggregation-expression-ast-design.md](../../orm-consolidation/plans/aggregation-expression-ast-design.md)

## Intent

Build the typed `MongoAggExpr` class hierarchy in `@prisma-next/mongo-query-ast` — the foundation for both read pipelines and pipeline-style computed writes. This is the missing expression layer: the existing filter expression AST (`MongoFilterExpr`) models predicates for `$match`, and the stage AST (`MongoReadStage`) models top-level pipeline operations, but neither can represent computed values like `{ $sum: "$amount" }` or `{ $concat: ["$first", " ", "$last"] }`. Without aggregation expressions, stages that need computed values (`$group`, computed `$project`, `$addFields`) cannot be represented as typed AST nodes.

## Context: two expression systems in MongoDB

MongoDB has two distinct expression systems with different syntax and contexts of use:

1. **Filter expressions** — used in `$match`, `find()`, update filters. Structure: `{ field: { $op: value } }`. Cannot reference other fields. Already represented by `MongoFilterExpr`.

2. **Aggregation expressions** — used in `$group`, `$project`, `$addFields`, `$replaceRoot`, `$bucket`, `$lookup` let bindings, and nested inside each other. A recursive expression tree that can reference fields (`"$name"`), perform computations (`{ $add: ["$price", "$tax"] }`), and compose arbitrarily.

The `$expr` operator bridges the two: inside `$match`, `$expr` wraps an aggregation expression to enable cross-field comparisons (e.g., `{ $match: { $expr: { $gt: ["$qty", "$minQty"] } } }`).

The full design rationale is in the [design doc](../../orm-consolidation/plans/aggregation-expression-ast-design.md).

## Scope

This task covers:

- All `MongoAggExpr` node classes (11 concrete classes)
- `MongoAggExprVisitor<R>` and `MongoAggExprRewriter` interfaces
- `lowerAggExpr()` visitor that produces MongoDB driver documents
- `MongoExprFilter` bridge class in the filter expression system
- Exports from `@prisma-next/mongo-query-ast`

This task does **not** cover:

- New pipeline stage classes (`MongoGroupStage`, `MongoAddFieldsStage`, etc.) — Milestone 3
- Pipeline builder with shape tracking — Milestone 4
- Pipeline-style updates — Milestone 5

## Class hierarchy

```
MongoAggExprNode (abstract, not exported)
├── MongoAggFieldRef       kind: 'fieldRef'       "$name", "$address.city"
├── MongoAggLiteral        kind: 'literal'        constant value; $literal escape for ambiguous values
├── MongoAggOperator       kind: 'operator'       uniform { $op: expr | [expr, ...] }
├── MongoAggAccumulator    kind: 'accumulator'    $sum, $avg, $min, $max, $first, $last, $push, $addToSet, $count
├── MongoAggCond           kind: 'cond'           { $cond: { if, then, else } }
├── MongoAggSwitch         kind: 'switch'         { $switch: { branches, default } }
├── MongoAggFilter         kind: 'filter'         { $filter: { input, cond, as } }
├── MongoAggMap            kind: 'map'            { $map: { input, in, as } }
├── MongoAggReduce         kind: 'reduce'         { $reduce: { input, initialValue, in } }
├── MongoAggLet            kind: 'let'            { $let: { vars, in } }
└── MongoAggMergeObjects   kind: 'mergeObjects'   { $mergeObjects: [expr, ...] }
```

The abstract base `MongoAggExprNode` extends `MongoAstNode` (shared with `MongoFilterExpression` and `MongoStageNode`) and declares `accept()` and `rewrite()`.

The exported union:

```typescript
type MongoAggExpr =
  | MongoAggFieldRef
  | MongoAggLiteral
  | MongoAggOperator
  | MongoAggAccumulator
  | MongoAggCond
  | MongoAggSwitch
  | MongoAggFilter
  | MongoAggMap
  | MongoAggReduce
  | MongoAggLet
  | MongoAggMergeObjects;
```

### Key design decisions

**`MongoAggOperator` uses `op: string`.** The majority of MongoDB aggregation operators share the same syntactic shape — `{ $op: expr }` or `{ $op: [expr, ...] }`. A single class with `op: string` covers all of them (arithmetic, comparison, string, array, date, type, object, set operators). This mirrors `MongoFieldFilter.op: string` in the filter system.

**`MongoAggOperator.args` is `MongoAggExpr | ReadonlyArray<MongoAggExpr>`.** This preserves the distinction between single-arg operators (`{ $toLower: expr }`) and array-arg operators (`{ $add: [a, b] }`) that MongoDB's wire format requires. Lowering emits the correct form based on whether `args` is an array or a single expression.

**Accumulators are separate from operators.** `MongoAggAccumulator` is structurally similar (`op: string` + single arg) but semantically restricted to `$group`/`$setWindowFields`. A separate class lets `MongoGroupStage` (Milestone 3) require `Record<string, MongoAggAccumulator>` for its accumulator fields, enforcing the restriction at the type level.

**Structurally unique operators get their own classes.** `$cond`, `$switch`, `$filter`, `$map`, `$reduce`, `$let`, and `$mergeObjects` each have unique argument shapes that don't fit the uniform `{ $op: expr | [expr] }` pattern.

## Visitor and rewriter

```typescript
interface MongoAggExprVisitor<R> {
  fieldRef(expr: MongoAggFieldRef): R;
  literal(expr: MongoAggLiteral): R;
  operator(expr: MongoAggOperator): R;
  accumulator(expr: MongoAggAccumulator): R;
  cond(expr: MongoAggCond): R;
  switch_(expr: MongoAggSwitch): R;
  filter(expr: MongoAggFilter): R;
  map(expr: MongoAggMap): R;
  reduce(expr: MongoAggReduce): R;
  let_(expr: MongoAggLet): R;
  mergeObjects(expr: MongoAggMergeObjects): R;
}

interface MongoAggExprRewriter {
  fieldRef?(expr: MongoAggFieldRef): MongoAggExpr;
  literal?(expr: MongoAggLiteral): MongoAggExpr;
  operator?(expr: MongoAggOperator): MongoAggExpr;
  accumulator?(expr: MongoAggAccumulator): MongoAggExpr;
  cond?(expr: MongoAggCond): MongoAggExpr;
  switch_?(expr: MongoAggSwitch): MongoAggExpr;
  filter?(expr: MongoAggFilter): MongoAggExpr;
  map?(expr: MongoAggMap): MongoAggExpr;
  reduce?(expr: MongoAggReduce): MongoAggExpr;
  let_?(expr: MongoAggLet): MongoAggExpr;
  mergeObjects?(expr: MongoAggMergeObjects): MongoAggExpr;
}
```

The visitor is exhaustive (every kind must be handled). The rewriter uses optional hooks — rewrite children bottom-up, then apply the hook for the current node. This is the same pattern as `MongoFilterRewriter`.

## Lowering

`lowerAggExpr()` is a `MongoAggExprVisitor<unknown>` that translates AST nodes to plain MongoDB driver documents:

| AST node | Lowered form |
|----------|-------------|
| `MongoAggFieldRef("name")` | `"$name"` |
| `MongoAggFieldRef("address.city")` | `"$address.city"` |
| `MongoAggLiteral(42)` | `42` |
| `MongoAggLiteral("$ambiguous")` | `{ $literal: "$ambiguous" }` |
| `MongoAggOperator("$add", [a, b])` | `{ $add: [lower(a), lower(b)] }` |
| `MongoAggOperator("$toLower", expr)` | `{ $toLower: lower(expr) }` |
| `MongoAggAccumulator("$sum", expr)` | `{ $sum: lower(expr) }` |
| `MongoAggAccumulator("$count", null)` | `{ $count: {} }` |
| `MongoAggCond(if, then, else)` | `{ $cond: { if: ..., then: ..., else: ... } }` |
| `MongoAggSwitch(branches, default)` | `{ $switch: { branches: [...], default: ... } }` |
| `MongoAggFilter(input, cond, as)` | `{ $filter: { input: ..., cond: ..., as: ... } }` |
| `MongoAggMap(input, in, as)` | `{ $map: { input: ..., in: ..., as: ... } }` |
| `MongoAggReduce(input, init, in)` | `{ $reduce: { input: ..., initialValue: ..., in: ... } }` |
| `MongoAggLet(vars, in)` | `{ $let: { vars: ..., in: ... } }` |
| `MongoAggMergeObjects(exprs)` | `{ $mergeObjects: [...] }` |

For `MongoAggLiteral`, lowering emits `{ $literal: value }` when the value would be ambiguous in MongoDB's expression syntax (strings starting with `$`, objects with `$`-prefixed keys). Unambiguous values pass through directly.

### Lowering placement

`lowerAggExpr()` lives in the adapter (`packages/3-mongo-target/2-mongo-adapter/src/lowering.ts`) alongside `lowerFilter()` and `lowerStage()`. Although aggregation expression lowering is target-agnostic (the MongoDB wire format is the same for all MongoDB targets), keeping it in the adapter follows the established pattern and avoids a layering change. Milestone 3 stages will call `lowerAggExpr()` from within `lowerStage()`.

## Bridge to filter expressions: `MongoExprFilter`

A new filter expression class bridges aggregation expressions into `$match` for cross-field comparisons:

```typescript
class MongoExprFilter extends MongoFilterExpression {
  readonly kind = 'expr' as const;
  readonly aggExpr: MongoAggExpr;
}
```

This requires updating:

- `MongoFilterExpr` union — add `MongoExprFilter`
- `MongoFilterVisitor<R>` — add `expr(expr: MongoExprFilter): R`
- `MongoFilterRewriter` — add `expr?(expr: MongoExprFilter): MongoFilterExpr`
- `lowerFilter()` in the adapter — add `case 'expr': return { $expr: lowerAggExpr(filter.aggExpr) }`
- Exhaustive switches on `MongoFilterExpr` — any existing consumers that switch on `filter.kind`

## Module organization

All new code lives within the existing `@prisma-next/mongo-query-ast` package:

```
packages/2-mongo-family/4-query/query-ast/src/
  ast-node.ts                     (existing — MongoAstNode, unchanged)
  filter-expressions.ts           (existing — add MongoExprFilter, update MongoFilterExpr union)
  aggregation-expressions.ts      (new — all MongoAggExpr node classes)
  visitors.ts                     (existing — add MongoAggExprVisitor, MongoAggExprRewriter,
                                              update MongoFilterVisitor, MongoFilterRewriter)
  stages.ts                       (existing — unchanged in this task)
  commands.ts                     (existing — unchanged in this task)
  exports/index.ts                (existing — add new exports)
```

Lowering:

```
packages/3-mongo-target/2-mongo-adapter/src/
  lowering.ts                     (existing — add lowerAggExpr(), update lowerFilter())
```

Tests:

```
packages/2-mongo-family/4-query/query-ast/test/
  aggregation-expressions.test.ts (new — construction, freezing, kind, visitor, rewriter)
  filter-expressions.test.ts      (existing — add MongoExprFilter tests)

packages/3-mongo-target/2-mongo-adapter/test/
  lowering.test.ts                (existing or new — lowerAggExpr() round-trip tests)
```

## Implementation tasks

### 1. Leaf nodes: `MongoAggFieldRef` and `MongoAggLiteral`

Create `aggregation-expressions.ts` with the hidden abstract base `MongoAggExprNode` (extends `MongoAstNode`, declares `accept()` and `rewrite()`). Implement `MongoAggFieldRef` and `MongoAggLiteral`.

`MongoAggFieldRef` stores a `path: string` (the field path without the `$` prefix — the `$` is a lowering concern, not an AST concern).

`MongoAggLiteral` stores a `value: unknown`. The AST node doesn't decide whether `$literal` wrapping is needed — that's a lowering decision.

**Tests:**
- Construction, `kind` discriminant, freezing for each class
- Static factory methods (e.g., `MongoAggFieldRef.of("name")`, `MongoAggLiteral.of(42)`)

### 2. Compound nodes: `MongoAggOperator` and `MongoAggAccumulator`

`MongoAggOperator`: `op: string`, `args: MongoAggExpr | ReadonlyArray<MongoAggExpr>`. Covers all uniform-shape operators. Static helpers for common operators (e.g., `MongoAggOperator.add(a, b)`, `MongoAggOperator.concat(a, b, c)`).

`MongoAggAccumulator`: `op: string`, `arg: MongoAggExpr | null` (`null` for `$count` which takes `{}`). Static helpers for common accumulators (e.g., `MongoAggAccumulator.sum(expr)`, `MongoAggAccumulator.count()`).

**Tests:**
- Construction with single and array args
- Freezing (including frozen arrays)
- Rejects `undefined` args where not permitted
- Static helpers produce correct `op` and `args`

### 3. Structurally unique nodes

`MongoAggCond`: `condition: MongoAggExpr`, `then_: MongoAggExpr`, `else_: MongoAggExpr`
`MongoAggSwitch`: `branches: ReadonlyArray<{ case_: MongoAggExpr; then_: MongoAggExpr }>`, `default_: MongoAggExpr`
`MongoAggFilter`: `input: MongoAggExpr`, `cond: MongoAggExpr`, `as: string`
`MongoAggMap`: `input: MongoAggExpr`, `in_: MongoAggExpr`, `as: string`
`MongoAggReduce`: `input: MongoAggExpr`, `initialValue: MongoAggExpr`, `in_: MongoAggExpr`
`MongoAggLet`: `vars: Readonly<Record<string, MongoAggExpr>>`, `in_: MongoAggExpr`
`MongoAggMergeObjects`: `exprs: ReadonlyArray<MongoAggExpr>`

Each follows the same pattern: constructor, static factory, `kind` discriminant, freezing.

**Tests:**
- Construction and freezing for each class
- `MongoAggSwitch` freezes branches array and each branch object
- `MongoAggLet` freezes vars record
- `MongoAggMergeObjects` freezes exprs array

### 4. Visitor and rewriter interfaces + wiring

Add `MongoAggExprVisitor<R>` and `MongoAggExprRewriter` to `visitors.ts`. Wire up `accept()` and `rewrite()` on all 11 node classes.

Rewriter behavior follows the filter expression pattern:
- **Leaf nodes** (`MongoAggFieldRef`, `MongoAggLiteral`): apply the rewriter hook directly, or return `this` if no hook
- **Container nodes**: rewrite children first (bottom-up), construct a new node with rewritten children, then apply the rewriter hook

**Tests:**
- Visitor dispatches to correct method for each node kind (exhaustive)
- Rewriter with no hooks returns identical structure (identity rewrite)
- Rewriter with a hook transforms only the targeted node kind
- Rewriter on a compound node rewrites children before applying the hook
- Deep nesting: rewriter reaches leaf nodes inside `MongoAggCond`, `MongoAggSwitch`, etc.

### 5. Lowering

Implement `lowerAggExpr()` as a `MongoAggExprVisitor<unknown>` in the adapter's `lowering.ts`.

Key lowering logic:
- `MongoAggFieldRef`: prepend `$` to the path → `"$name"`
- `MongoAggLiteral`: pass through for unambiguous values; wrap in `{ $literal: value }` for strings starting with `$` or objects with `$`-prefixed keys
- `MongoAggOperator`: `{ [op]: lower(args) }` — single expr or `args.map(lower)` for arrays
- `MongoAggAccumulator`: `{ [op]: lower(arg) }` or `{ [op]: {} }` for `$count`
- Structural nodes: emit their specific MongoDB shapes with recursively lowered children

**Tests:**
- Round-trip tests for every node type: construct AST → lower → compare to expected MongoDB document
- `MongoAggLiteral` ambiguity detection: `"$ambiguous"` → `{ $literal: "$ambiguous" }`, `42` → `42`, `{ $foo: 1 }` → `{ $literal: { $foo: 1 } }`
- `MongoAggOperator` single-arg vs array-arg lowering
- Nested expression lowering (operator containing field refs and literals)
- `MongoAggAccumulator("$count", null)` → `{ $count: {} }`

### 6. `MongoExprFilter` bridge

Add `MongoExprFilter` to `filter-expressions.ts`. Update `MongoFilterExpr` union. Add `expr` method to `MongoFilterVisitor` and `MongoFilterRewriter` in `visitors.ts`.

Update `lowerFilter()` in the adapter to handle `case 'expr'`.

**Tests:**
- Construction and freezing
- Visitor dispatch
- Rewriter (recurses into the aggregation expression via `MongoAggExprRewriter`? — No: `MongoExprFilter.rewrite()` applies the filter rewriter hook only. The aggregation expression is opaque from the filter rewriter's perspective. A consumer that needs to rewrite both filter and aggregation expressions would use separate rewriters.)
- Lowering: `MongoExprFilter` wrapping `MongoAggOperator("$gt", [fieldRef("qty"), fieldRef("minQty")])` → `{ $expr: { $gt: ["$qty", "$minQty"] } }`

### 7. Type tests

Dedicated `.test-d.ts` file(s) in `packages/2-mongo-family/4-query/query-ast/test/` to verify compile-time guarantees:

**Discriminated union exhaustiveness:**
- Switching on `MongoAggExpr['kind']` requires handling all 11 kinds — missing a case is a compile-time error
- Switching on `MongoFilterExpr['kind']` requires handling the new `'expr'` kind in addition to existing kinds

**Visitor exhaustiveness:**
- `MongoAggExprVisitor<R>` requires all 11 methods — omitting one is a compile-time error
- Updated `MongoFilterVisitor<R>` requires the `expr` method

**Rewriter optionality:**
- `MongoAggExprRewriter` accepts an empty object `{}` (all hooks optional)
- Each hook's return type is `MongoAggExpr` (the union, not a specific subtype)

**`accept()` return type:**
- `expr.accept(visitor)` returns `R` for a `MongoAggExprVisitor<R>` regardless of which concrete node class calls it

**`rewrite()` return type:**
- `expr.rewrite(rewriter)` returns `MongoAggExpr` (union type) for all node classes

**Union membership:**
- Each concrete class is assignable to `MongoAggExpr`
- `MongoExprFilter` is assignable to `MongoFilterExpr`

**Structural type safety:**
- `MongoAggOperator.args` accepts both `MongoAggExpr` and `ReadonlyArray<MongoAggExpr>`
- `MongoAggAccumulator.arg` accepts `MongoAggExpr | null`
- `MongoAggSwitch.branches` is `ReadonlyArray` (immutable)
- `MongoAggLet.vars` is `Readonly<Record<...>>` (immutable)

### 8. Integration tests against mongodb-memory-server

The `MongoExprFilter` bridge enables one end-to-end integration test within this milestone: construct a typed `$expr` filter inside a `$match` stage, execute it via the full runtime pipeline against mongodb-memory-server, and verify correct results.

This test goes in `test/integration/test/mongo/` alongside the existing ORM integration tests. It uses the `describeWithMongoDB` helper for server lifecycle.

**Test cases:**

**Cross-field comparison via `$expr`:**
- Seed documents with `qty` and `minQty` fields (e.g., `{ item: "A", qty: 10, minQty: 5 }`, `{ item: "B", qty: 3, minQty: 8 }`)
- Construct: `MongoExprFilter(MongoAggOperator.of("$gt", [MongoAggFieldRef.of("qty"), MongoAggFieldRef.of("minQty")]))`
- Embed in `MongoMatchStage`, wrap in `AggregateCommand`, build `MongoQueryPlan`
- Execute via runtime, verify only documents where `qty > minQty` are returned

**Computed `$expr` with arithmetic:**
- Seed documents with `price` and `discount` fields
- Construct: `MongoExprFilter(MongoAggOperator.of("$gt", [MongoAggFieldRef.of("price"), MongoAggOperator.of("$multiply", [MongoAggFieldRef.of("discount"), MongoAggLiteral.of(2)])]))`
- Verify correct filtering with nested expression evaluation

**`$expr` combined with regular filter:**
- Combine a `MongoExprFilter` with a `MongoFieldFilter` in a `MongoAndExpr`
- Verify both predicates are applied

**Note on `$group`/`$project`/`$addFields` integration tests:** These require `MongoGroupStage`, `MongoAddFieldsStage`, etc. which are Milestone 3 deliverables. Full integration testing of aggregation expressions in non-filter contexts (accumulators, computed projections, array transforms) will follow in Milestone 3 task 3.8. The `$expr` bridge is the only path from aggregation expressions to executed queries in this milestone.

### 9. Exports

Update `exports/index.ts` to export:
- All 11 concrete `MongoAggExpr` node classes
- `MongoAggExpr` union type
- `MongoExprFilter`
- `MongoAggExprVisitor`, `MongoAggExprRewriter` types
- Updated `MongoFilterExpr`, `MongoFilterVisitor`, `MongoFilterRewriter`

## Sequencing

```
1. Leaf nodes (MongoAggFieldRef, MongoAggLiteral) + tests
2. Compound nodes (MongoAggOperator, MongoAggAccumulator) + tests
3. Structurally unique nodes (Cond, Switch, Filter, Map, Reduce, Let, MergeObjects) + tests
4. Visitor and rewriter interfaces + wire accept()/rewrite() on all nodes + tests
5. Type tests (.test-d.ts)
6. Lowering (lowerAggExpr()) + unit tests
7. MongoExprFilter bridge + update filter system + lowering + tests
8. Integration tests against mongodb-memory-server
9. Exports
```

Steps 1–3 can be done in a single pass (they're small and have no external dependencies). Step 4 depends on all node classes existing. Step 5 depends on step 4 (type tests verify visitor/rewriter/union contracts). Step 6 depends on step 4 (lowering is a visitor). Step 7 depends on steps 4 and 6 (bridge needs both systems wired). Step 8 depends on step 7 (integration tests use `MongoExprFilter`). Step 9 is last.

In practice, the natural commit sequence is:

1. **Commit: leaf and compound nodes** — `MongoAggExprNode` base, `MongoAggFieldRef`, `MongoAggLiteral`, `MongoAggOperator`, `MongoAggAccumulator` + unit tests
2. **Commit: structurally unique nodes** — `MongoAggCond`, `MongoAggSwitch`, `MongoAggFilter`, `MongoAggMap`, `MongoAggReduce`, `MongoAggLet`, `MongoAggMergeObjects` + unit tests
3. **Commit: visitor and rewriter** — interfaces + `accept()`/`rewrite()` wiring + unit tests + type tests
4. **Commit: lowering** — `lowerAggExpr()` + round-trip unit tests
5. **Commit: `MongoExprFilter` bridge** — bridge class + filter system updates + lowering case + unit tests
6. **Commit: integration tests** — `$expr` end-to-end tests against mongodb-memory-server
7. **Commit: exports** — export wiring

## Test file inventory

| File | Package | Type | Covers |
|------|---------|------|--------|
| `query-ast/test/aggregation-expressions.test.ts` | `@prisma-next/mongo-query-ast` | Unit | Construction, freezing, kind, visitor dispatch, rewriter transforms for all 11 node classes |
| `query-ast/test/aggregation-expressions.test-d.ts` | `@prisma-next/mongo-query-ast` | Type | Union exhaustiveness, visitor exhaustiveness, rewriter optionality, `accept()`/`rewrite()` return types, structural type constraints |
| `query-ast/test/filter-expressions.test.ts` | `@prisma-next/mongo-query-ast` | Unit | `MongoExprFilter` construction, freezing, visitor dispatch, rewriter (added to existing file) |
| `query-ast/test/filter-expressions.test-d.ts` | `@prisma-next/mongo-query-ast` | Type | Updated `MongoFilterExpr` union includes `MongoExprFilter`, updated `MongoFilterVisitor` requires `expr` method |
| `mongo-adapter/test/lowering.test.ts` | `@prisma-next/adapter-mongo` | Unit | `lowerAggExpr()` round-trip for all node types, literal ambiguity, `lowerFilter()` with `$expr` |
| `integration/test/mongo/expr-filter.test.ts` | Integration | Integration | Cross-field `$expr` comparison, nested arithmetic `$expr`, `$expr` combined with regular filters — all against mongodb-memory-server |

## Validation

Complete when:

- [ ] All 11 `MongoAggExpr` node classes extend `MongoAstNode`, are immutable (frozen), and have a `kind` discriminant
- [ ] `MongoAggExprVisitor<R>` is exhaustive — every expression kind must be handled (verified by type test)
- [ ] `MongoAggExprRewriter` supports partial overrides — empty `{}` compiles (verified by type test)
- [ ] Switching on `MongoAggExpr['kind']` requires all 11 cases (verified by type test)
- [ ] `lowerAggExpr()` produces correct MongoDB driver documents for all expression node types (verified by unit tests)
- [ ] `MongoAggLiteral` lowering correctly wraps ambiguous values in `{ $literal: ... }` (verified by unit test)
- [ ] `MongoExprFilter` bridge works: `MongoExprFilter(MongoAggOperator("$gt", [fieldRef("qty"), fieldRef("minQty")]))` lowers to `{ $expr: { $gt: ["$qty", "$minQty"] } }` (verified by unit test)
- [ ] `$expr` cross-field comparison executes correctly against mongodb-memory-server (verified by integration test)
- [ ] `MongoFilterExpr` union includes `MongoExprFilter` (verified by type test)
- [ ] `MongoFilterVisitor` and `MongoFilterRewriter` include `expr` method (verified by type test)
- [ ] All new types exported from `@prisma-next/mongo-query-ast`
- [ ] All existing tests pass unchanged (no regressions in filter expressions, stages, commands)
- [ ] `pnpm lint:deps` passes (no layering violations)
