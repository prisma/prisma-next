# @prisma-next/mongo-query-builder

A typed CRUD query builder for MongoDB contracts. Reads, writes, pipeline aggregations, and find-and-modify operations all produce `MongoQueryPlan` values that the runtime executes. Authored against a contract, not directly against the driver.

## Quick start

```typescript
import { mongoQuery } from '@prisma-next/mongo-query-builder';

const q = mongoQuery<TContract>({ contractJson: contract });

// Read — aggregation pipeline
const analytics = q
  .from('orders')
  .match((f) => f.status.eq('completed'))
  .group((f) => ({
    _id: f.department,
    totalRevenue: acc.sum(f.amount),
  }))
  .sort({ totalRevenue: -1 })
  .build();

// Write — filtered update
const updated = q
  .from('orders')
  .match((f) => f.total.gt(100))
  .updateMany((f) => [f.status.set('shipped')]);

// Find-and-modify
const doc = q
  .from('orders')
  .match((f) => f.status.eq('pending'))
  .sort({ createdAt: 1 })
  .findOneAndUpdate((f) => [f.status.set('processing')], { returnDocument: 'after' });
```

Each call returns a `MongoQueryPlan` with a narrowly typed `command` field and a phantom `Row` type parameter that tracks the shape of the result.

## The three states

The builder is a three-state machine. The available terminals depend on where you are in the chain.

### CollectionHandle

Returned by `q.from('rootName')`. Represents an unfiltered collection binding.

| Terminals | Description |
|-----------|-------------|
| `insertOne(doc)` | Insert a single document |
| `insertMany(docs)` | Insert a batch of documents |
| `updateAll(fn)` | Update every document (match-all filter) |
| `deleteAll()` | Delete every document |
| `upsertOne(filterFn, updaterFn)` | Insert-or-update with an explicit filter |
| `match(...)` | Transitions to **FilteredCollection** |
| *stage methods* | Transitions to **PipelineChain** |

### FilteredCollection

Reached after one or more `.match(...)` calls on a `CollectionHandle`. Filters accumulate via AND-folding.

| Terminals | Description |
|-----------|-------------|
| `updateMany(fn)` | Update all matching documents |
| `updateOne(fn)` | Update one matching document |
| `deleteMany()` | Delete all matching documents |
| `deleteOne()` | Delete one matching document |
| `upsertOne(fn)` | Upsert against the accumulated filter |
| `findOneAndUpdate(fn, opts?)` | Find + update, returns the document |
| `findOneAndDelete()` | Find + delete, returns the deleted document |
| `match(...)` | Appends another filter |
| *stage methods* | Transitions to **PipelineChain** |

### PipelineChain

The general-purpose aggregation chain. Reached after calling any pipeline stage (e.g. `.sort()`, `.group()`, `.addFields()`).

| Terminals | Description |
|-----------|-------------|
| `build()` / `aggregate()` | Produce an `AggregateCommand` |
| `out(collection)` | `$out` terminal |
| `merge(opts)` | `$merge` terminal |
| `updateMany()` / `updateOne()` | Pipeline-style update (no callback — the chain _is_ the update) |
| `findOneAndUpdate(fn)` | Deconstructs `$match`/`$sort`/`$skip` into command slots |
| `findOneAndDelete()` | Same deconstruction |

## Field accessor

Stage callbacks receive a `FieldAccessor<Shape, Nested>` (typically named `f`):

- **Property form** — `f.status`, `f.amount`: produces a `TypedAggExpr` bound to the field's declared type.
- **Callable form** — `f("address.city")`: type-safe dot-path traversal through the contract's model + value-object structure. Paths are validated at compile time against `ValidPaths<Nested>`, the resolved leaf's codec drives the returned expression, and IDE autocomplete surfaces the valid path union. Non-leaf paths (`f("address")`) return an `Expression<ObjectField<…>>` whose reduced operator surface exposes `set`, `unset`, `exists`, `eq(null)`, and `ne(null)` — operators that don't make sense on a whole value object (`gt`, `inc`, `push`, …) are hidden.

  The callable form is disabled (at the type level) downstream of replacement stages (`project`, `group`, `replaceRoot`, …) that erase the nested structure; additive stages (`match`, `sort`, `addFields`, `lookup`, …) preserve it.

- **Escape hatch** — `f.rawPath("path")`: sidesteps path validation and returns a `LeafExpression<DocField>` carrying the verbatim string path. Use when the path is intentionally outside the typed model — the canonical case is **migration authoring**, where a backfill writes to a field that is not yet in the pre-migration contract (see the retail-store example's `backfill-product-status` migration). `f.rawPath` offers the full leaf operator surface (`set`, `exists`, `inc`, `push`, …) and no IDE autocomplete. Callers can narrow the return via an explicit generic: `f.rawPath<StringField>("status").set("active")`. The method is named `rawPath` rather than `raw` so a user model with a legitimate top-level `raw` field still resolves `f.raw` to the field expression.

  See [ADR 180 — Dot-path field accessor](../../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) for the design rationale.

## Update operators

Write terminals accept a callback `(f) => [...]` returning an array of `TypedUpdateOp`:

```typescript
.updateMany((f) => [
  f.status.set('shipped'),
  f.amount.inc(1),
  f.tags.push('processed'),
])
```

Available operators: `.set`, `.unset`, `.inc`, `.mul`, `.min`, `.max`, `.push`, `.pull`, `.addToSet`, `.pop`, `.rename`, `.currentDate`, `.bit`.

## Pipeline-style updates

For updates expressed as aggregation pipeline stages, use `f.stage.*`:

```typescript
q.from('orders')
  .match((f) => f.status.eq('new'))
  .addFields((f) => ({ total: fn.multiply(f.quantity, f.price) }))
  .updateMany()  // no callback — the chain is the update pipeline
```

Stage emitters: `f.stage.set(fields)`, `f.stage.unset(...fields)`, `f.stage.replaceRoot(expr)`, `f.stage.replaceWith(expr)`.

## Marker gating

Some pipeline stages (`group`, `project`, `replaceRoot`, `limit`, etc.) change the chain's document shape in ways that make typed `update`/`findOneAndModify` unsound. Those terminals disappear from the type after such stages. Trust the compiler; use `.aggregate()` for untyped pipeline results.

## `rawCommand` escape hatch

```typescript
const plan = q.rawCommand(new InsertOneCommand('orders', { status: 'new' }));
```

Bypasses the typed builder surface entirely. The plan still carries `meta.storageHash` from the contract, but the row type is `unknown`. Use this for commands the typed API does not yet cover.

## Observability

All plans carry `meta.lane === 'mongo-query'`. Middleware that needs finer-grained read-vs-write discrimination can inspect `plan.command` (which is a tagged union — `instanceof AggregateCommand`, `instanceof UpdateManyCommand`, etc.).

## Architecture

See [DEVELOPING.md](./DEVELOPING.md) for internal implementation details, module structure, and design decisions.
