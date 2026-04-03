# ADR 183 — Pipeline-only query representation for MongoDB

## At a glance

All MongoDB read queries compile to aggregation pipeline stages. The `find()` API is not used. `FindCommand` is removed from the command hierarchy; `AggregateCommand` (backed by typed pipeline stage nodes) is the sole read command.

```typescript
// ORM Collection compiles to a pipeline:
const users = await db.users
  .where((u) => u.email.eq('alice@example.com'))
  .include('posts')
  .orderBy([(u) => u.createdAt.desc()])
  .take(10)
  .all();

// Compiles to:
// AggregateCommand('users', [
//   MongoMatchStage({ email: { $eq: 'alice@example.com' } }),
//   MongoLookupStage({ from: 'posts', localField: '_id', foreignField: 'authorId', as: 'posts' }),
//   MongoSortStage({ createdAt: -1 }),
//   MongoLimitStage(10),
// ])
```

## Context

MongoDB provides two read APIs:

1. **`find(filter, options)`** — the original query API. Supports filter, projection, sort, limit, skip. No joins, no grouping, no computed fields.
2. **`aggregate(pipeline)`** — the aggregation framework. An ordered array of typed stage documents (`$match`, `$lookup`, `$project`, `$sort`, `$group`, `$addFields`, etc.) where each stage transforms the document stream.

`find()` is a strict subset of `aggregate()`. Every `find()` call has an equivalent pipeline:

| `find()` option | Pipeline equivalent |
|---|---|
| `filter` | `$match` |
| `projection` | `$project` |
| `sort` | `$sort` |
| `skip` | `$skip` |
| `limit` | `$limit` |

The reverse is not true — `$lookup` (joins), `$group`, `$addFields`, `$replaceRoot`, and computed expressions have no `find()` equivalent.

The current Mongo execution pipeline maintains both code paths: `FindCommand` for simple queries and `AggregateCommand` for queries with includes (`$lookup`). The ORM decides at compilation time which command to produce.

## Problem

Maintaining two read command types creates three problems:

1. **Dual compilation paths.** The ORM must decide whether to produce `FindCommand` or `AggregateCommand` and has separate compilation logic for each. Every new query feature (select, orderBy, cursor pagination) must be implemented twice — once as `FindOptions` fields and once as pipeline stages.

2. **Dual lowering paths.** The adapter dispatches on command kind (`find` vs `aggregate`), with separate lowering logic for each. The driver does the same.

3. **No foundation for the pipeline query builder.** The future type-safe aggregation pipeline query builder (the Mongo equivalent of the SQL query builder) needs typed pipeline stage nodes. If the ORM uses `FindCommand` for simple queries, the pipeline stage types only cover the `$lookup` path — they're a special case, not the canonical representation.

## Decision

**All MongoDB read queries compile to aggregation pipelines.** `FindCommand` is removed from the command hierarchy for reads. The query plan representation is a typed array of pipeline stage nodes.

### Typed pipeline stages

Pipeline stages are a discriminated union of typed nodes, not `Record<string, unknown>`:

```typescript
type MongoReadStage =
  | MongoMatchStage      // $match — contains a MongoFilterExpr
  | MongoLookupStage     // $lookup — typed join spec
  | MongoProjectStage    // $project — typed projection spec
  | MongoSortStage       // $sort — typed sort spec
  | MongoUnwindStage     // $unwind — typed unwind spec
  | MongoLimitStage      // $limit
  | MongoSkipStage       // $skip
  // Future stages added as needed:
  // | MongoGroupStage   // $group — typed group key + accumulators
  // | MongoAddFieldsStage
  // | MongoReplaceRootStage
  // | MongoFacetStage
```

Each stage is a concrete type with a `kind` discriminant. The adapter lowers typed stages to the plain document arrays the MongoDB driver expects.

### Layering

| Layer | Responsibility |
|---|---|
| **ORM / pipeline builder** | Produces `MongoReadStage[]` from `CollectionState` or builder API |
| **`AggregateCommand`** | Carries `pipeline: MongoReadStage[]` (typed, not `RawPipeline`) |
| **Adapter** | Lowers `MongoReadStage[]` → `Record<string, unknown>[]` (plain documents for the driver) |
| **Driver** | Calls `collection.aggregate(pipeline)` — always |

### What this replaces

- `FindCommand` is removed as a read command. It may be retained for internal driver-level optimization in the future (the adapter could choose to emit a `find()` call when the pipeline is trivially simple), but this is an adapter-internal optimization invisible to the query plan layer.
- `RawPipeline` (`ReadonlyArray<Record<string, unknown>>`) is replaced by `MongoReadStage[]` for ORM-produced queries. Raw pipeline passthrough (for escape-hatch queries) continues to use untyped arrays.

### Write commands are unaffected

`InsertOneCommand`, `UpdateOneCommand`, and `DeleteOneCommand` remain as they are. This decision applies only to read queries.

## Alternatives considered

### Keep `find()` as an optimization for simple queries

Produce `FindCommand` when the query has no `$lookup`, `$group`, or other pipeline-only stages. This saves the overhead of an aggregation pipeline for simple filter+sort+limit queries.

**Rejected.** The performance difference between `find()` and a simple pipeline (`[$match, $sort, $limit]`) is marginal on modern MongoDB (the query planner optimizes both). The cost of maintaining two compilation paths, two lowering paths, and two sets of tests far outweighs the micro-optimization. If profiling ever shows a measurable difference, the adapter can internally emit `find()` calls for trivially simple pipelines — this is an adapter-internal optimization that doesn't need to leak into the query plan representation.

### Use untyped pipeline arrays (`RawPipeline`)

Keep `AggregateCommand` but leave the pipeline as `ReadonlyArray<Record<string, unknown>>`.

**Rejected.** Untyped pipeline arrays provide no compile-time safety, make it impossible to inspect or transform pipeline stages programmatically, and provide no foundation for a type-safe pipeline query builder. Typed stage nodes are essential for the same reasons the SQL side uses a typed AST rather than raw SQL strings.

## Costs

- **`FindCommand` removal.** Existing code that produces or dispatches on `FindCommand` must be updated. The ORM's `findMany` implementation, the adapter's `#lowerCommand`, and the driver's `execute` method all branch on `find` vs `aggregate`.
- **Typed stage definitions.** Each pipeline stage type must be defined, with lowering logic in the adapter. This is upfront work, but it's work that the pipeline query builder would require regardless.

## Benefits

- **Single compilation path.** The ORM compiles `CollectionState` to one thing: a `MongoReadStage[]` array. No branching on whether the query needs `$lookup`.
- **Single lowering path.** The adapter lowers `MongoReadStage[]` → `Document[]`. The driver always calls `aggregate()`.
- **Pipeline query builder foundation.** The typed stage nodes are the same types the pipeline query builder will compose. The ORM and the pipeline builder produce the same representation — they're two different surfaces for building the same plan.
- **Composability.** Typed stages can be inspected, filtered, reordered, and merged programmatically — useful for middleware, query optimization, and debugging.
