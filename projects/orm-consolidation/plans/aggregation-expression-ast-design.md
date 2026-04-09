# Aggregation Expression AST — Design

Design for a typed representation of MongoDB aggregation expressions in `@prisma-next/mongo-query-ast`. These expressions are a recursive tree structure used inside pipeline stages like `$group`, `$project`, `$addFields`, `$bucket`, and `$replaceRoot`.

**Precedent:** The filter expression AST (`MongoFilterExpr`) in the same package — class hierarchy with `kind` discriminant, abstract bases hidden from export, `accept()`/`rewrite()`, immutable frozen instances.

**Context:** [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md), [Milestone 1 pipeline AST design](./milestone-1-pipeline-ast-design.md).

## MongoDB has two distinct expression systems

MongoDB has two expression systems with different syntax, different capabilities, and different contexts of use. Understanding the distinction is critical to the AST design.

### 1. Query filter expressions

Used in `$match`, `find()`, update filters, and delete filters. Structure: `{ field: { $operator: value } }` for field conditions, `{ $logical: [...] }` for combinators.

```javascript
// Field condition: "age is greater than or equal to 18"
{ age: { $gte: 18 } }

// Logical combinator: "status is active AND age >= 18"
{ $and: [{ status: "active" }, { age: { $gte: 18 } }] }

// Multiple field conditions (implicit AND):
{ status: "active", age: { $gte: 18 } }
```

Filter expressions **cannot reference other fields**. `{ age: { $gt: "$minAge" } }` compares `age` to the literal string `"$minAge"`, not to the value of the `minAge` field. This is a fundamental limitation.

Our existing `MongoFilterExpr` AST (`MongoFieldFilter`, `MongoAndExpr`, `MongoOrExpr`, `MongoNotExpr`, `MongoExistsExpr`) represents this system.

### 2. Aggregation expressions

Used in `$group`, `$project`, `$addFields`, `$replaceRoot`, `$bucket`, `$sortByCount`, within `$lookup` let bindings, and nested inside each other. These are a **recursive expression tree** that can reference fields, perform computations, and compose arbitrarily.

Aggregation expressions are the subject of this design document.

## How aggregation expressions work

### Field references

Field references use the `$` prefix. A bare string starting with `$` evaluates to the value of that field in the current document:

```javascript
"$name"            // value of the 'name' field
"$address.city"    // value of nested field 'city' within 'address'
```

This is the leaf node of the expression tree. Note the difference from filter expressions: in a filter, `"$name"` is a literal string; in an aggregation expression, it's a field dereference.

### Operator expressions

Operator expressions are objects with a single `$`-prefixed key. The value is the operator's argument — which can itself be an expression, an array of expressions, or a structured object:

```javascript
// Single argument:
{ $toUpper: "$name" }                          // → "ALICE"
{ $abs: "$balance" }                           // → 42

// Array of arguments:
{ $add: ["$price", "$tax"] }                   // → 110
{ $concat: ["$firstName", " ", "$lastName"] }  // → "Alice Smith"

// Nested operator expressions — this is where the recursive tree comes in:
{ $multiply: [
    "$price",
    { $subtract: [1, "$discountRate"] }        // nested expression
] }
```

Every position that accepts an expression can receive a field reference, a literal value, or another operator expression. The tree can nest to arbitrary depth.

### Literal values

Any value that isn't a `$`-prefixed string and isn't an object with `$`-prefixed keys is a literal:

```javascript
42          // number
"hello"     // string (no $ prefix)
true        // boolean
null        // null
```

For values that would otherwise be interpreted as expressions (e.g., a string starting with `$`, or an object with `$`-prefixed keys), MongoDB provides an explicit escape:

```javascript
{ $literal: "$notAFieldRef" }    // the literal string "$notAFieldRef"
{ $literal: { $foo: "bar" } }   // a literal object, not an operator
```

### Categories of operators

Most MongoDB aggregation operators follow a uniform shape: `{ $op: expr }` or `{ $op: [expr, expr, ...] }`. This uniform subset includes:

**Arithmetic:** `$add`, `$subtract`, `$multiply`, `$divide`, `$mod`, `$abs`, `$ceil`, `$floor`, `$round`, `$pow`, `$sqrt`, `$log`, `$ln`, `$exp`, `$trunc`

**Comparison:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$cmp` — these return boolean/integer values, unlike filter operators which are predicates

**String:** `$concat`, `$substr`, `$substrBytes`, `$toLower`, `$toUpper`, `$trim`, `$ltrim`, `$rtrim`, `$split`, `$strLenBytes`, `$strLenCP`, `$regexMatch`, `$regexFind`, `$regexFindAll`, `$replaceOne`, `$replaceAll`

**Array:** `$arrayElemAt`, `$first` (array), `$last` (array), `$size`, `$concatArrays`, `$slice`, `$reverseArray`, `$in`, `$indexOfArray`, `$isArray`, `$range`, `$zip`

**Date:** `$year`, `$month`, `$dayOfMonth`, `$hour`, `$minute`, `$second`, `$millisecond`, `$dayOfWeek`, `$dayOfYear`, `$week`, `$dateToString`, `$dateFromString`, `$dateTrunc`, `$dateAdd`, `$dateDiff`

**Type conversion:** `$convert`, `$toBool`, `$toDate`, `$toDecimal`, `$toDouble`, `$toInt`, `$toLong`, `$toObjectId`, `$toString`, `$type`

**Object:** `$objectToArray`, `$arrayToObject`, `$getField`, `$setField`, `$unsetField`

**Set:** `$setIntersection`, `$setUnion`, `$setDifference`, `$setEquals`, `$setIsSubset`, `$anyElementTrue`, `$allElementsTrue`

All of these have the same syntactic shape — a `$`-prefixed key whose value is a single expression or array of expressions. A single AST node class with an `op: string` field can represent all of them.

### Structurally unique operators

A few operators have argument shapes that don't fit the uniform `{ $op: expr | [expr] }` pattern:

**Conditional `$cond`** — if/then/else:

```javascript
{ $cond: { if: { $gte: ["$age", 18] }, then: "adult", else: "minor" } }
// shorthand array form: { $cond: [condition, trueCase, falseCase] }
```

**Switch `$switch`** — multi-branch conditional:

```javascript
{ $switch: {
    branches: [
      { case: { $eq: ["$status", "active"] }, then: "Active" },
      { case: { $eq: ["$status", "pending"] }, then: "Pending" },
    ],
    default: "Unknown"
} }
```

**Array filter `$filter`** — filter elements of an array:

```javascript
{ $filter: {
    input: "$scores",        // the array to filter
    as: "score",             // variable name for each element
    cond: { $gte: ["$$score", 70] }  // condition using the variable
} }
```

The `as` field introduces a variable binding — `$$score` refers to the current element during iteration. This is the first example of a **let-style binding** in the expression tree.

**Array map `$map`** — transform each element of an array:

```javascript
{ $map: {
    input: "$items",
    as: "item",
    in: { $multiply: ["$$item.price", "$$item.quantity"] }
} }
```

**Reduce `$reduce`** — fold an array to a single value:

```javascript
{ $reduce: {
    input: "$items",
    initialValue: 0,
    in: { $add: ["$$value", "$$this.price"] }
} }
```

**Let `$let`** — introduce named variables:

```javascript
{ $let: {
    vars: {
      total: { $add: ["$price", "$tax"] },
      discount: "$discountRate"
    },
    in: { $multiply: ["$$total", { $subtract: [1, "$$discount"] }] }
} }
```

**Merge objects `$mergeObjects`** — combine multiple documents:

```javascript
{ $mergeObjects: ["$defaults", "$overrides", { status: "active" }] }
```

These operators each have a unique argument structure and deserve their own AST node classes.

### Accumulators

Accumulators are operators that can **only** be used inside `$group` (and `$setWindowFields`). They aggregate values across multiple documents within a group. Their syntax looks like other operators, but they're semantically restricted:

```javascript
{ $group: {
    _id: "$city",
    count: { $sum: 1 },              // count documents per group
    totalRevenue: { $sum: "$amount" }, // sum a field's values
    avgAge: { $avg: "$age" },         // arithmetic mean
    oldest: { $max: "$age" },         // maximum value
    youngest: { $min: "$age" },       // minimum value
    firstOrder: { $first: "$orderId" }, // first value (order depends on prior $sort)
    lastOrder: { $last: "$orderId" },   // last value
    allNames: { $push: "$name" },      // collect all values into an array
    uniqueTags: { $addToSet: "$tag" },  // collect unique values into an array
    stdDev: { $stdDevPop: "$score" },   // population standard deviation
} }
```

The argument to each accumulator is an aggregation expression — it can be a field reference, a literal, or a computed expression:

```javascript
totalWithTax: { $sum: { $multiply: ["$price", 1.2] } }
// Accumulator ($sum) whose argument is a computed expression ($multiply)
```

The `$count` accumulator is unique — it takes an empty object, not an expression: `{ $count: {} }`.

Accumulators are structurally similar to the uniform `{ $op: expr }` operators, but they need to be a separate concept in the AST because:

1. They're semantically restricted — only valid inside `$group` and `$setWindowFields`, not in `$project` or `$addFields`
2. The `MongoGroupStage` should require accumulator expressions in its accumulator fields, not arbitrary expressions
3. Each accumulator has a known relationship between its input and output types (e.g., `$sum` → number, `$push` → array), which the pipeline builder's type system needs to leverage

### The bridge: `$expr` in `$match`

The two expression systems intersect via `$expr`. Inside a `$match` stage, `$expr` wraps an aggregation expression and uses it as a filter predicate. This is the only way to do cross-field comparisons in a filter context:

```javascript
{ $match: { $expr: { $gt: ["$qty", "$minQty"] } } }
// Compares the qty field TO the minQty field — impossible with filter expressions alone
```

## Representation design

### Design principles

1. **Follow the filter expression pattern.** Class hierarchy rooted at a hidden abstract base (`MongoAggExprNode`). Concrete classes with `kind` discriminant. Exported as a discriminated union (`MongoAggExpr`). `accept()` for visitors, `rewrite()` for transformations. Immutable frozen instances.

2. **One class per structurally distinct argument shape.** Operators that share the uniform `{ $op: expr | [expr] }` shape are represented by a single class with `op: string`. Operators with unique argument structures (conditional, let bindings, array transforms) get their own classes.

3. **Open operator set.** Like `MongoFieldFilter.op: string` in the filter system, `MongoAggOperator.op` and `MongoAggAccumulator.op` are strings, not closed enums. New operators can be represented without new AST classes.

4. **Separate accumulators from general operators.** Although structurally similar to `MongoAggOperator`, accumulators are a distinct concept that's restricted to specific stage contexts. A separate class enables the type system to enforce this restriction.

5. **Contract-agnostic.** The expression AST deals in MongoDB expression concepts (field paths, operators, accumulators), not contract concepts (models, codecIds). The pipeline builder bridges the gap between contract types and raw expressions.

### Class hierarchy

```
MongoAggExprNode (abstract, hidden)
├── abstract readonly kind: string
├── abstract accept<R>(visitor: MongoAggExprVisitor<R>): R
├── abstract rewrite(rewriter: MongoAggExprRewriter): MongoAggExpr
│
├── MongoAggFieldRef            kind: 'fieldRef'
│   Field path reference: "$name", "$address.city"
│   Fields: path: string
│
├── MongoAggLiteral             kind: 'literal'
│   Constant value, or $literal escape for ambiguous values
│   Fields: value: unknown
│
├── MongoAggOperator            kind: 'operator'
│   Uniform { $op: expr | [expr, ...] } operators
│   Fields: op: string, args: MongoAggExpr | ReadonlyArray<MongoAggExpr>
│   Covers: arithmetic, comparison, string, array, date, type, object, set operators
│
├── MongoAggAccumulator         kind: 'accumulator'
│   Group/window accumulators: $sum, $avg, $min, $max, $first, $last, $push, $addToSet, $count
│   Fields: op: string, arg: MongoAggExpr | null (null for $count)
│   Restricted to $group and $setWindowFields contexts
│
├── MongoAggCond                kind: 'cond'
│   { $cond: { if, then, else } }
│   Fields: condition: MongoAggExpr, then_: MongoAggExpr, else_: MongoAggExpr
│
├── MongoAggSwitch              kind: 'switch'
│   { $switch: { branches: [{ case, then }], default } }
│   Fields: branches: ReadonlyArray<{ case_: MongoAggExpr, then_: MongoAggExpr }>,
│           default_: MongoAggExpr
│
├── MongoAggArrayFilter         kind: 'filter'
│   { $filter: { input, cond, as } }
│   Fields: input: MongoAggExpr, cond: MongoAggExpr, as: string
│
├── MongoAggMap                 kind: 'map'
│   { $map: { input, in, as } }
│   Fields: input: MongoAggExpr, in_: MongoAggExpr, as: string
│
├── MongoAggReduce              kind: 'reduce'
│   { $reduce: { input, initialValue, in } }
│   Fields: input: MongoAggExpr, initialValue: MongoAggExpr, in_: MongoAggExpr
│
├── MongoAggLet                 kind: 'let'
│   { $let: { vars: Record<string, expr>, in: expr } }
│   Fields: vars: Readonly<Record<string, MongoAggExpr>>, in_: MongoAggExpr
│
└── MongoAggMergeObjects        kind: 'mergeObjects'
    { $mergeObjects: [expr, ...] }
    Fields: exprs: ReadonlyArray<MongoAggExpr>
```

### Exported union

```typescript
type MongoAggExpr =
  | MongoAggFieldRef
  | MongoAggLiteral
  | MongoAggOperator
  | MongoAggAccumulator
  | MongoAggCond
  | MongoAggSwitch
  | MongoAggArrayFilter
  | MongoAggMap
  | MongoAggReduce
  | MongoAggLet
  | MongoAggMergeObjects;
```

### Why `MongoAggOperator` uses `op: string`

The uniform operator class handles the majority of MongoDB aggregation operators. All of these have the same syntactic shape — `{ $op: singleExpr }` or `{ $op: [expr, expr, ...] }`:

```typescript
// Arithmetic: $add, $subtract, $multiply, $divide, $mod, $abs, $ceil, $floor, $round
// String: $concat, $substr, $toLower, $toUpper, $trim, $split
// Comparison: $eq, $ne, $gt, $gte, $lt, $lte, $cmp
// Date: $year, $month, $dayOfMonth, $dateToString, $dateDiff
// Type: $convert, $toBool, $toDate, $toDouble, $toInt, $toString, $type
// Array: $arrayElemAt, $size, $concatArrays, $slice, $reverseArray, $in, $isArray
// Object: $objectToArray, $arrayToObject, $getField, $setField
// Set: $setIntersection, $setUnion, $setDifference, $setEquals
```

A single class with `op: string` represents all of them without an explosion of classes. This mirrors `MongoFieldFilter.op: string` in the filter expression system. The visitor dispatches to a single `operator()` method; consumers who need to distinguish specific operators inspect `op`.

`MongoAggAccumulator` is structurally similar (`op: string` + single arg) but separated because accumulators are semantically restricted to `$group`/`$setWindowFields`. This lets `MongoGroupStage` require `Record<string, MongoAggAccumulator>` for its accumulator fields.

### Rewriter behavior

The `rewrite()` method on each node recursively rewrites child expressions bottom-up, then applies the rewriter hook for the current node. This is the same pattern as `MongoFilterExpression.rewrite()`:

- **Leaf nodes** (`MongoAggFieldRef`, `MongoAggLiteral`): apply the rewriter hook directly
- **Container nodes** (`MongoAggOperator`, `MongoAggCond`, etc.): rewrite children first, construct a new node with rewritten children, then apply the rewriter hook

For example, `MongoAggOperator.rewrite()`:

```typescript
rewrite(rewriter: MongoAggExprRewriter): MongoAggExpr {
  const rewrittenArgs = Array.isArray(this.args)
    ? this.args.map(a => a.rewrite(rewriter))
    : this.args.rewrite(rewriter);
  const rebuilt = new MongoAggOperator(this.op, rewrittenArgs);
  return rewriter.operator ? rewriter.operator(rebuilt) : rebuilt;
}
```

### Visitor and rewriter interfaces

```typescript
interface MongoAggExprVisitor<R> {
  fieldRef(expr: MongoAggFieldRef): R;
  literal(expr: MongoAggLiteral): R;
  operator(expr: MongoAggOperator): R;
  accumulator(expr: MongoAggAccumulator): R;
  cond(expr: MongoAggCond): R;
  switch_(expr: MongoAggSwitch): R;
  filter(expr: MongoAggArrayFilter): R;
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
  filter?(expr: MongoAggArrayFilter): MongoAggExpr;
  map?(expr: MongoAggMap): MongoAggExpr;
  reduce?(expr: MongoAggReduce): MongoAggExpr;
  let_?(expr: MongoAggLet): MongoAggExpr;
  mergeObjects?(expr: MongoAggMergeObjects): MongoAggExpr;
}
```

The visitor is exhaustive — every expression kind must be handled. The rewriter uses optional hooks — override only the node kinds you want to transform.

### Lowering

Lowering translates typed expression nodes into the plain documents the MongoDB driver expects. It is implemented as a `MongoAggExprVisitor<unknown>`:

| AST node | Lowered form |
|----------|-------------|
| `MongoAggFieldRef("name")` | `"$name"` |
| `MongoAggFieldRef("address.city")` | `"$address.city"` |
| `MongoAggLiteral(42)` | `42` (pass-through for unambiguous values) |
| `MongoAggLiteral("$ambiguous")` | `{ $literal: "$ambiguous" }` |
| `MongoAggOperator("$add", [a, b])` | `{ $add: [lower(a), lower(b)] }` |
| `MongoAggOperator("$toLower", expr)` | `{ $toLower: lower(expr) }` |
| `MongoAggAccumulator("$sum", expr)` | `{ $sum: lower(expr) }` |
| `MongoAggAccumulator("$count", null)` | `{ $count: {} }` |
| `MongoAggCond(if, then, else)` | `{ $cond: { if: lower(if), then: lower(then), else: lower(else) } }` |
| `MongoAggSwitch(branches, default)` | `{ $switch: { branches: [...], default: lower(default) } }` |
| `MongoAggArrayFilter(input, cond, as)` | `{ $filter: { input: lower(input), cond: lower(cond), as: as } }` |
| `MongoAggMap(input, in, as)` | `{ $map: { input: lower(input), in: lower(in), as: as } }` |
| `MongoAggReduce(input, init, in)` | `{ $reduce: { input: lower(input), initialValue: lower(init), in: lower(in) } }` |
| `MongoAggLet(vars, in)` | `{ $let: { vars: mapValues(lower, vars), in: lower(in) } }` |
| `MongoAggMergeObjects(exprs)` | `{ $mergeObjects: exprs.map(lower) }` |

For `MongoAggLiteral`, the lowering decides whether to emit the raw value or wrap it in `{ $literal: ... }` based on whether the value would be ambiguous in MongoDB's expression syntax (strings starting with `$`, objects with `$`-prefixed keys).

`MongoAggOperator` lowering distinguishes between single-arg and array-arg forms based on whether `args` is an array or a single expression.

### Bridge to filter expressions: `$expr`

To support `$expr` inside `$match`, a new filter expression kind bridges the two systems:

```typescript
class MongoExprFilter extends MongoFilterExpression {
  readonly kind = 'expr' as const;
  readonly aggExpr: MongoAggExpr;
}
```

This lets filter expressions embed aggregation expressions for cross-field comparisons:

```typescript
new MongoMatchStage(
  new MongoExprFilter(
    new MongoAggOperator('$gt', [
      new MongoAggFieldRef('qty'),
      new MongoAggFieldRef('minQty'),
    ])
  )
)
// Lowered: { $match: { $expr: { $gt: ["$qty", "$minQty"] } } }
```

`MongoExprFilter` is added to the `MongoFilterExpr` union and the `MongoFilterVisitor`/`MongoFilterRewriter` interfaces gain an `expr` method.

## Implementation

### Module organization

The aggregation expression AST lives in a new module within `@prisma-next/mongo-query-ast`:

```
src/
  aggregation-expressions.ts    MongoAggFieldRef, MongoAggLiteral, MongoAggOperator,
                                MongoAggAccumulator, MongoAggCond, MongoAggSwitch,
                                MongoAggArrayFilter, MongoAggMap, MongoAggReduce,
                                MongoAggLet, MongoAggMergeObjects, MongoAggExpr union
```

The hidden abstract base `MongoAggExprNode` lives in the same module (not exported). It extends the shared `MongoAstNode` from `ast-node.ts`.

The `MongoAggExprVisitor<R>` and `MongoAggExprRewriter` interfaces are added to `visitors.ts`.

The `MongoExprFilter` bridge class is added to `filter-expressions.ts` and the `MongoFilterExpr` union.

Lowering is added alongside the existing `lowerFilter`/`lowerStage` functions.

### Relationship to existing ASTs

The aggregation expression AST is a **sibling** of the filter expression AST, not a parent or child. They share the `MongoAstNode` base for the `kind` discriminant and `freeze()` pattern, but have separate abstract bases, separate visitor interfaces, and separate union types.

The only connection is `MongoExprFilter` in the filter expression system, which wraps a `MongoAggExpr` for `$expr` support.

```
MongoAstNode (shared base)
├── MongoFilterExpression → MongoFilterExpr union (existing)
│   └── MongoExprFilter (new — bridges to aggregation expressions)
├── MongoAggExprNode → MongoAggExpr union (new)
└── MongoStageNode → MongoPipelineStage union (extended in pipeline AST doc)
```

### Relationship to the pipeline builder

The pipeline builder (designed separately) wraps `MongoAggExpr` nodes in a `TypedAggExpr<F>` that carries the expression's output type as a phantom type parameter. This allows the builder to compute how `$group`, `$project`, and `$addFields` stages transform the document shape at the type level.

The AST itself is contract-agnostic and untyped — it deals in field paths and operator names, not codec IDs and TypeScript types. The type-level machinery lives entirely in the builder layer.

### Reuse for pipeline-style updates (computed writes)

MongoDB 4.2+ supports passing an aggregation pipeline as the `update` parameter to `updateOne`, `updateMany`, and `findOneAndUpdate`. This **pipeline-style update** allows computed writes — setting a field based on another field's value, using conditional logic, concatenating strings, etc. — capabilities that traditional update operators (`$set`, `$inc`, `$push`) cannot express.

```javascript
// Traditional operator update — can only set static values:
db.users.updateMany({ active: true }, { $set: { name: "Bob" } })

// Pipeline-style update — can reference other fields and compute:
db.users.updateMany({ active: true }, [
  { $set: { fullName: { $concat: ["$firstName", " ", "$lastName"] } } },
  { $set: { discountedPrice: { $multiply: ["$price", { $subtract: [1, "$discountRate"] }] } } },
  { $set: { tier: { $cond: { if: { $gte: ["$purchases", 100] }, then: "gold", else: "silver" } } } },
])
```

The values inside pipeline-style `$set`/`$addFields` stages are **aggregation expressions** — exactly the `MongoAggExpr` nodes this document designs. This means the aggregation expression AST serves both:

1. **Read pipelines** — expressions inside `$group`, `$project`, `$addFields`, `$bucket`, `$replaceRoot` etc.
2. **Computed writes** — expressions inside pipeline-style update `$set`/`$addFields` stages

Pipeline-style updates support only a subset of stages: `$addFields`/`$set`, `$unset`, `$replaceRoot`/`$replaceWith`, and `$project`. These are all stages that transform individual documents without changing cardinality — no `$group`, `$sort`, `$match`, `$lookup`, or other stream-reshaping stages.

This is a significant value-add: the `MongoAggExpr` class hierarchy, visitors, rewriters, and lowering logic are shared infrastructure for both reads and writes. The aggregation expression AST is the foundation for both the pipeline query builder and a future computed-update surface.

**Relationship to ADR 180 (dot-path field accessor):** ADR 180's mutation surface (`.set()`, `.inc()`, `.push()`) maps to MongoDB's traditional update operators, which are a separate, simpler mechanism. Pipeline-style updates are complementary — they handle computed writes that traditional operators cannot express. Both use dot notation for field access but in fundamentally different expression systems:

| Need | Mechanism | AST |
|------|-----------|-----|
| Set a field to a literal value | Traditional `$set` operator | `MongoValue` (existing) |
| Increment, push, pull | Traditional operators (`$inc`, `$push`, etc.) | ADR 180 field accessor |
| Set a field based on another field | Pipeline `$set` + `MongoAggExpr` | `MongoAggExpr` (this doc) |
| Conditional update logic | Pipeline `$set` + `$cond`/`$switch` | `MongoAggExpr` (this doc) |

The update commands (`UpdateOneCommand`, `UpdateManyCommand`, `FindOneAndUpdateCommand`) currently accept `Record<string, MongoValue>` for the traditional operator form. To enable pipeline-style updates, they will need to accept either form — see [Pipeline AST completeness design](./pipeline-ast-completeness-design.md) for the update command changes.

## References

- [Milestone 1 pipeline AST design](./milestone-1-pipeline-ast-design.md) — existing filter expression and stage AST
- [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [Pipeline AST completeness design](./pipeline-ast-completeness-design.md) — companion doc for pipeline stage extensions
- [Pipeline builder design](./pipeline-builder-design.md) — companion doc for the query builder
- [MongoDB aggregation expressions reference](https://www.mongodb.com/docs/manual/meta/aggregation-quick-reference/#expressions)
