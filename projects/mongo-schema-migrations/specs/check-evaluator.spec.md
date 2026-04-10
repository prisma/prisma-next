# Check Evaluator Design

## Context

Migration operations carry **prechecks** and **postchecks** — assertions about the state of the database before and after a DDL command runs. Each check is expressed as a MongoDB filter expression (`MongoFilterExpr`) applied against the results of an inspection command like `listIndexes` or `listCollections` (see [Operation AST design](operation-ast.spec.md) for how checks are authored and serialized). These inspection commands are MongoDB admin commands that return all results — they don't support server-side query filters. The check evaluator is the client-side interpreter that evaluates `MongoFilterExpr` against those plain JavaScript result documents, determining whether a check passes or fails.

## Grounding example

The runner needs to verify that an index on `users.email` exists. The postcheck in the migration operation says:

```typescript
{
  description: 'unique index exists',
  source: new ListIndexesCommand('users'),
  filter: MongoAndExpr.of([
    MongoFieldFilter.eq('key', { email: 1 }),
    MongoFieldFilter.eq('unique', true),
  ]),
  expect: 'exists',
}
```

The runner calls `db.collection('users').listIndexes().toArray()` and gets back:

```json
[
  { "v": 2, "key": { "_id": 1 }, "name": "_id_" },
  { "v": 2, "key": { "email": 1 }, "name": "email_1", "unique": true }
]
```

The check evaluator takes the filter expression and evaluates it against each document:

1. `{ "v": 2, "key": { "_id": 1 }, "name": "_id_" }` — `key` is `{ _id: 1 }`, not `{ email: 1 }` → no match
2. `{ "v": 2, "key": { "email": 1 }, "name": "email_1", "unique": true }` — `key` equals `{ email: 1 }` AND `unique` equals `true` → match

At least one document matches and the expectation is `'exists'` → check passes.

No MongoDB server interaction happens during the evaluation itself — the filter is applied in-process against plain JavaScript objects. The same `MongoFilterExpr` AST used in query `$match` stages is reused here, just interpreted client-side rather than lowered to BSON and sent to the server.

## Key decisions

1. **Reuse `MongoFilterExpr`.** The check evaluator interprets the existing filter expression AST from `@prisma-next/mongo-query-ast`. No new expression types, no new DSL. The same `MongoFieldFilter`, `MongoAndExpr`, `MongoOrExpr`, `MongoNotExpr`, `MongoExistsExpr` classes used in queries work unchanged for checks.

2. **Implement as `MongoFilterVisitor<boolean>`.** The evaluator implements the existing `MongoFilterVisitor<R>` interface with `R = boolean`. This follows the established visitor pattern and means the evaluator is just another consumer of the filter AST — alongside the lowering visitor that produces BSON and the rewriter that transforms expressions.

3. **Deep equality for `$eq`.** When `MongoFieldFilter.eq('key', { email: 1 })` is evaluated, the evaluator performs recursive structural equality between the document's `key` field and the expected value `{ email: 1 }`. This matches MongoDB's own `$eq` semantics for embedded documents.

4. **Inspection commands have known result shapes.** `listIndexes` returns index descriptors with fields `key`, `name`, `unique`, `sparse`, etc. `listCollections` returns collection info with fields `name`, `type`, `options`, etc. These shapes are well-defined by MongoDB and can be typed at authoring time.

## Inspection command result shapes

Each inspection command returns documents with a known shape. These shapes are defined by MongoDB and are stable across versions.

### `listIndexes` result shape

```typescript
interface IndexInfoDocument {
  readonly v: number;
  readonly key: Record<string, number | string>;
  readonly name: string;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly collation?: Record<string, unknown>;
  readonly hidden?: boolean;
}
```

### `listCollections` result shape

```typescript
interface CollectionInfoDocument {
  readonly name: string;
  readonly type: 'collection' | 'view';
  readonly options: {
    readonly validator?: Record<string, unknown>;
    readonly validationLevel?: string;
    readonly validationAction?: string;
    readonly capped?: boolean;
    readonly size?: number;
    readonly max?: number;
    readonly collation?: Record<string, unknown>;
  };
  readonly info: {
    readonly readOnly: boolean;
  };
}
```

### Typed check construction

At authoring time (in the planner), these shapes can be used to type-check filter expressions. A helper function could enforce that the filter field paths are valid for the inspection command's result type:

```typescript
function indexCheck(
  collection: string,
  filter: MongoFilterExpr,
  expect: 'exists' | 'notExists',
  description: string,
): MongoMigrationCheck {
  return {
    description,
    source: new ListIndexesCommand(collection),
    filter,
    expect,
  };
}
```

The planner code gets type safety from the known result shapes. The serialized JSON in `ops.json` doesn't carry type information — but the evaluator handles whatever filter expression it receives.

## Evaluator implementation

The evaluator is a `MongoFilterVisitor<boolean>` that takes a document and returns whether the filter matches:

```typescript
class FilterEvaluator implements MongoFilterVisitor<boolean> {
  private doc: Record<string, unknown> = {};

  evaluate(filter: MongoFilterExpr, doc: Record<string, unknown>): boolean {
    this.doc = doc;
    return filter.accept(this);
  }

  field(expr: MongoFieldFilter): boolean {
    const value = getNestedField(this.doc, expr.field);
    return evaluateFieldOp(expr.op, value, expr.value);
  }

  and(expr: MongoAndExpr): boolean {
    return expr.exprs.every(child => child.accept(this));
  }

  or(expr: MongoOrExpr): boolean {
    return expr.exprs.some(child => child.accept(this));
  }

  not(expr: MongoNotExpr): boolean {
    return !expr.expr.accept(this);
  }

  exists(expr: MongoExistsExpr): boolean {
    const has = getNestedField(this.doc, expr.field) !== undefined;
    return expr.exists ? has : !has;
  }

  expr(_expr: MongoExprFilter): boolean {
    throw new Error('Aggregation expression filters are not supported in migration checks');
  }
}
```

### Field access

Dotted field paths (e.g., `options.validator.$jsonSchema`) are resolved by walking nested objects:

```typescript
function getNestedField(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = doc;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
```

### Operator evaluation

The evaluator supports the core MongoDB comparison operators:

```typescript
function evaluateFieldOp(op: string, actual: unknown, expected: MongoValue): boolean {
  switch (op) {
    case '$eq':
      return deepEquals(actual, expected);
    case '$ne':
      return !deepEquals(actual, expected);
    case '$gt':
      return typeof actual === typeof expected && (actual as number) > (expected as number);
    case '$gte':
      return typeof actual === typeof expected && (actual as number) >= (expected as number);
    case '$lt':
      return typeof actual === typeof expected && (actual as number) < (expected as number);
    case '$lte':
      return typeof actual === typeof expected && (actual as number) <= (expected as number);
    case '$in':
      return Array.isArray(expected) && expected.some(v => deepEquals(actual, v));
    default:
      throw new Error(`Unsupported filter operator in migration check: ${op}`);
  }
}
```

### Deep equality

`$eq` on objects requires recursive structural comparison. This matches MongoDB's `$eq` semantics for embedded documents — key order matters, values are compared recursively:

```typescript
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEquals(val, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => deepEquals(aObj[key], bObj[key]));
  }

  return false;
}
```

**Key-order sensitivity.** MongoDB's `$eq` is key-order-sensitive for object values: `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are **not** equal. The `deepEquals` implementation above preserves this behavior by iterating `Object.keys(aObj)` and checking that each key at each position matches. This is significant for index key specs, where `{ email: 1, name: -1 }` is a different compound index from `{ name: -1, email: 1 }` — the field order determines the index's sort order and query coverage.

## Check examples

The following table summarizes how checks are constructed for common migration operations. The grounding example above shows the full TypeScript structure; the [Operation AST spec](operation-ast.spec.md#check-examples-by-operation) has the complete check table across all operation types.

| Scenario | Source | Filter | Expect |
|---|---|---|---|
| Create index precheck | `listIndexes('users')` | `key = { email: 1 }` | `notExists` |
| Create index postcheck | `listIndexes('users')` | `key = { email: 1 } AND unique = true` | `exists` |
| Drop index precheck | `listIndexes('users')` | `key = { email: 1 }` | `exists` |
| Create collection postcheck | `listCollections()` | `name = 'orders'` | `exists` |
| Update validator postcheck | `listCollections()` | `name = 'users' AND options.validator = {...}` | `exists` |
| TTL index postcheck | `listIndexes('sessions')` | `key = { createdAt: 1 } AND expireAfterSeconds = 3600` | `exists` |

## Check evaluation in the runner

The runner uses the evaluator in three contexts: (1) **idempotency probe** — before executing an operation, evaluate all postchecks to detect if the operation was already applied and can be skipped; (2) **prechecks** — before execution, verify preconditions hold (abort with `PRECHECK_FAILED` if any fails); (3) **postchecks** — after execution, verify the DDL command had the expected effect (abort with `POSTCHECK_FAILED` if any fails). In each case, the runner calls the inspection command, feeds the results to `FilterEvaluator`, and interprets the match result against the check's `expect` field. See the [Planner + Runner design](planner-runner.spec.md#execution-flow) for the full three-phase execution loop.

## Package placement

The `FilterEvaluator` lives in the target package (`packages/3-mongo-target/`), alongside the runner and command executor. It depends only on the filter expression types from `@prisma-next/mongo-query-ast`, which are in the Mongo family layer — a valid dependency direction.

The inspection command result shapes (`IndexInfoDocument`, `CollectionInfoDocument`) are type-only and could live either in the target package or in a shared types package. For M1, keeping them in the target package is simplest.

## Testing strategy

The evaluator is a pure function — no I/O, no database. Unit tests cover:

- **Operator semantics**: `$eq` (primitives, nested objects, arrays), `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`
- **Logical combinators**: `$and`, `$or`, `$not` with nested expressions
- **Field existence**: `$exists: true`, `$exists: false`
- **Dotted field paths**: `options.validator.$jsonSchema` resolves through nested objects
- **Deep equality**: key order sensitivity, array comparison, mixed types
- **Edge cases**: missing fields, `null` values, empty objects, empty arrays
- **Error cases**: unsupported operators, `MongoExprFilter` (should throw)

Integration tests (in the runner tests) verify the evaluator works correctly with real `listIndexes` and `listCollections` output from `mongodb-memory-server`.

## Alternatives considered

### Why not evaluate checks server-side?

We could send the filter expression to MongoDB as a query (e.g., `db.collection.listIndexes().filter(...)` or an aggregation pipeline). Server-side evaluation would avoid implementing a client-side interpreter.

We chose client-side evaluation because:

1. **`listIndexes` and `listCollections` don't support query filters.** These are admin commands that return all results. Client-side filtering is required regardless.
2. **Consistency.** The evaluator uses the same expression semantics everywhere. Server-side evaluation would introduce subtle semantic differences between MongoDB versions.
3. **Testability.** A pure function is trivially testable without a database.
4. **Reusability.** The evaluator is useful beyond migration checks — for testing, dry-run simulation, and debugging.

### Why not a structural subset match instead of filter expressions?

A simpler check model would use plain JSON subset matching: "does any result document contain these key-value pairs?" This would avoid the filter expression AST entirely.

We chose filter expressions because:

1. **Already exists.** The `MongoFilterExpr` AST is fully defined, tested, and serializable.
2. **More expressive.** Subset matching can't express negation, disjunction, field existence checks, or range comparisons. Filter expressions can.
3. **Familiar.** Users know `$eq`, `$and`, `$exists` from MongoDB queries.
4. **Typed.** Filter expressions are AST nodes with typed fields, not opaque JSON blobs.

The trade-off is implementation complexity — a filter evaluator is more code than a subset matcher. But the evaluator is straightforward (see implementation above) and the expressiveness pays for itself in validator and collection option checks.

### Why not support `MongoExprFilter` (aggregation expressions)?

The `MongoExprFilter` node wraps a full aggregation expression (`MongoAggExpr`) as a filter. Supporting it in the evaluator would require implementing a client-side aggregation expression interpreter — significantly more complex than the filter evaluator.

For migration checks, the basic filter operators (`$eq`, `$and`, `$exists`, etc.) are sufficient. If a future use case requires aggregation expression evaluation, the evaluator can be extended — the visitor interface already has the `expr` method slot.
