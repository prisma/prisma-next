# Mongo Pipeline Builder

Task-oriented reference for `@prisma-next/mongo-query-builder` — the typed builder that composes MongoDB aggregation pipelines and write/find-and-modify terminals against a validated Mongo contract.

For the architectural picture (state machine, marker types, lane contract) see [Subsystem 10 — MongoDB Family](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md). For *why* aggregate is the only read API see [ADR 183 — Aggregation pipeline only, never `find()` API](../architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md).

## Entry point

The builder enters from `mongoQuery(...)` bound to a validated contract:

```ts
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const { contract } = validateMongoContract<Contract>(contractJson);
const query = mongoQuery<Contract>({ contractJson });

const plan = query.from('orders').build();
```

`query.from(rootName)` returns a `CollectionHandle` — the root state of a three-state machine (`CollectionHandle` → `FilteredCollection` → `PipelineChain`). Every chain ends in a terminal that produces a `MongoQueryPlan`:

- `.build()` / `.aggregate()` — read terminal (returns rows).
- `.insertOne(...)`, `.insertMany(...)`, `.updateAll(fn)`, `.deleteAll()`, `.upsertOne(filterFn, fn)` — unqualified writes (only on `CollectionHandle`).
- `.match(...).updateMany(fn)` / `.updateOne(fn)` / `.deleteMany()` / `.deleteOne()` / `.upsertOne(fn)` — filtered writes.
- `.match(...).findOneAndUpdate(fn, opts?)` / `.findOneAndDelete()` — find-and-modify.
- `.out(coll, db?)` / `.merge({...})` — pipeline write terminals.

Plans flow through the runtime in [`mongo-query` lane](../architecture%20docs/subsystems/3.%20Query%20Lanes.md). For raw commands the builder cannot express, use `query.rawCommand(cmd)`.

## Stage coverage

Every supported stage with one minimal example. Examples assume `const orders = query.from('orders');` and the `acc` / `fn` helpers from `@prisma-next/mongo-query-builder`:

```ts
import { acc, fn } from '@prisma-next/mongo-query-builder';
```

### Filter, sort, paginate

`$match` — by filter expression or by callback over a typed `FieldAccessor`:

```ts
orders.match((f) => f.status.eq('active')).build();
```

`$sort`:

```ts
orders.sort({ amount: -1 }).build();
```

`$limit`, `$skip`, `$sample`:

```ts
orders.limit(10).build();
orders.skip(20).build();
orders.sample(3).build();
```

### Reshape

`$addFields` — additive, preserves shape:

```ts
orders
  .addFields((f) => ({ label: fn.concat(f.status, fn.literal('!')) }))
  .build();
```

`$project` — inclusion form (keys propagate statically) or computed form:

```ts
orders.project('status', 'amount').build();

orders
  .project((f) => ({ status: 1 as const, upper: fn.toUpper(f.status) }))
  .build();
```

`$replaceRoot` (alias `$replaceWith` is folded into the same stage):

```ts
orders.replaceRoot((f) => f.customer).build();
```

`$unwind`:

```ts
orders.unwind('items', { preserveNullAndEmptyArrays: true }).build();
```

### Aggregate

`$group`. The `_id` key may be `null` (whole-collection grouping) or any expression; every other key must be an accumulator:

```ts
orders
  .group((f) => ({
    _id: f.customerId,
    total: acc.sum(f.amount),
    orderCount: acc.count(),
  }))
  .build();
```

`$count`:

```ts
orders.count('totalOrders').build();
```

`$sortByCount`:

```ts
orders.sortByCount((f) => f.status).build();
```

`$bucket` and `$bucketAuto` — `groupBy` takes a raw `MongoAggExpr` (commonly built with `MongoAggFieldRef.of('field')`):

```ts
import { MongoAggFieldRef } from '@prisma-next/mongo-query-ast/execution';

orders
  .bucket({ groupBy: MongoAggFieldRef.of('amount'), boundaries: [0, 100, 1000] })
  .build();

orders.bucketAuto({ groupBy: MongoAggFieldRef.of('amount'), buckets: 5 }).build();
```

### Join

`$lookup` — typed equi-join. The callback grounds the foreign root, then `on(...)` selects the `local` and `foreign` fields, and `as(...)` names the sidecar array:

```ts
orders
  .lookup((from) =>
    from('users')
      .on((local, foreign) => ({ local: local.customerId, foreign: foreign._id }))
      .as('customer'),
  )
  .build();
```

`$graphLookup` — recursive lookup. `startWith` is a raw `MongoAggExpr`:

```ts
import { MongoAggFieldRef } from '@prisma-next/mongo-query-ast/execution';

orders
  .graphLookup({
    from: 'orders',
    startWith: MongoAggFieldRef.of('parentId'),
    connectFromField: 'parentId',
    connectToField: '_id',
    as: 'ancestors',
  })
  .build();
```

`$unionWith`:

```ts
orders.unionWith('archivedOrders').build();
```

### Geo

`$geoNear`:

```ts
orders
  .geoNear({
    near: { type: 'Point', coordinates: [-73.98, 40.76] },
    distanceField: 'distance',
    spherical: true,
  })
  .build();
```

### Window

`$setWindowFields`. `partitionBy` is a raw `MongoAggExpr`; `output` entries are `MongoWindowField` records:

```ts
import { MongoAggFieldRef } from '@prisma-next/mongo-query-ast/execution';

orders
  .setWindowFields({
    partitionBy: MongoAggFieldRef.of('customerId'),
    sortBy: { createdAt: 1 },
    output: {
      runningTotal: {
        $sum: '$amount',
        window: { documents: ['unbounded', 'current'] },
      },
    },
  })
  .build();
```

`$densify`, `$fill`:

```ts
orders.densify({ field: 'createdAt', range: { step: 1, unit: 'day', bounds: 'full' } }).build();
orders
  .fill({ sortBy: { createdAt: 1 }, output: { amount: { method: 'linear' } } })
  .build();
```

### Search (Atlas-only)

`$search`, `$searchMeta` — accept a raw config object today; a typed Atlas Search extension pack is tracked in [TML-2449](https://linear.app/prisma-company/issue/TML-2449/mongo-atlas-search-extension-pack-dollarsearch-stage-fl-15):

```ts
orders.search({ text: { query: 'red', path: 'name' } }, 'default').build();
```

`$vectorSearch` — accepts a raw options object today; a typed surface with codec-aware result typing is tracked in [TML-2446](https://linear.app/prisma-company/issue/TML-2446/mongo-pipeline-builder-add-dollarvectorsearch-stage-fl-07):

```ts
orders
  .vectorSearch({
    index: 'embedding_idx',
    path: 'embedding',
    queryVector: [0.1, 0.2, 0.3],
    numCandidates: 100,
    limit: 10,
  })
  .build();
```

### Multi-pipeline

`$facet` — `facet` takes raw `MongoPipelineStage[]` per branch (the typed surface does not yet propagate per-branch shapes):

```ts
import { MongoLimitStage } from '@prisma-next/mongo-query-ast/execution';

orders
  .facet({
    recent: [new MongoLimitStage(10)],
    sample: [new MongoLimitStage(100)],
  })
  .build();
```

### Filter expression

`$redact`:

```ts
orders.redact((f) => fn.literal('$$KEEP')).build();
```

### Write terminals (pipeline `$out` / `$merge`)

`$out` — replace destination collection:

```ts
orders.match((f) => f.status.eq('archived')).out('archivedOrders');
```

`$merge` — incremental merge:

```ts
orders
  .group((f) => ({ _id: f.customerId, total: acc.sum(f.amount) }))
  .merge({ into: 'customerTotals', on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' });
```

### Escape hatch

`pipe(stage)` — append any `MongoPipelineStage` directly. Clears the typed shape (supply `NewShape` if downstream stages need to see typed fields):

```ts
import { MongoLimitStage } from '@prisma-next/mongo-query-ast/execution';

orders.pipe(new MongoLimitStage(5)).build();
```

For commands the typed surface cannot express at all, drop to `query.rawCommand(cmd)`.

## Codec interaction

Codecs are how the contract translates between BSON wire values and TypeScript values (`mongo/objectid@1`, `mongo/double@1`, `mongo/string@1`, …). The pipeline builder's relationship to codecs is asymmetric today:

- **Result decoding** (read terminals): result rows pass through codecs at the adapter/driver boundary, so `.aggregate()` / `.build()` / `.findOneAndUpdate(...)` yield TypeScript values, not raw BSON. The static row type is computed from the contract's type maps via `ResolveRow<Shape, ExtractMongoCodecTypes<TContract>, TContract>`.
- **Write inputs** (mutations): `insertOne`, `insertMany`, and updater callbacks (`f.amount.set(123)`, `f.tags.push('x')`) flow through the contract's mutation-side encoders per [ADR 184 — Codec-owned value serialization](../architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md).
- **Filter values** (reads): values inside `match(...)` filter expressions are **not** auto-encoded by the builder. They are passed straight through as `MongoFilterExpr` AST nodes, so an `ObjectId` field filter must currently be expressed as a raw `MongoParamRef` with the correct `codecId`. This is a known framework gap tracked in [TML-2444](https://linear.app/prisma-company/issue/TML-2444/mongo-orm-where-does-not-encode-filter-values-through-codecs-fl-06) — the same gap that affects the ORM's `where()`. Workaround: wrap ObjectId-string filters in a small helper (see the retail-store example's `objectIdEq()`).

For the codec model itself see [Subsystem 5 — Adapters & Targets](../architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md) and the [Codec authoring guide](./codec-authoring-guide.md).

## Known gaps

- **`$vectorSearch` typed surface** — currently accepts a raw options object; a typed surface with shape-tracked results and codec-aware vectors is tracked in [TML-2446](https://linear.app/prisma-company/issue/TML-2446/mongo-pipeline-builder-add-dollarvectorsearch-stage-fl-07). Likely lands as an Atlas extension pack.
- **`$search` extension pack** — `$search` / `$searchMeta` accept raw configs today. A typed Atlas Search extension pack with index-dependency declarations is tracked in [TML-2449](https://linear.app/prisma-company/issue/TML-2449/mongo-atlas-search-extension-pack-dollarsearch-stage-fl-15).
- **Filter-side codec encoding** — see [TML-2444](https://linear.app/prisma-company/issue/TML-2444/mongo-orm-where-does-not-encode-filter-values-through-codecs-fl-06) above.
- **`$facet` typed branches** — branch arrays are currently `MongoPipelineStage[]`, not chained typed builders. Works, but does not propagate per-branch shapes.
- **Anything else** — drop to `pipe(stage)` for unknown stages on a known shape, or `query.rawCommand(cmd)` for entirely unmodelled commands.

## Type guarantees

The builder propagates the following statically:

- **Document shape** through additive (`$addFields`, `$lookup`), narrowing (`$project`, `$unwind`), and replacement (`$group`, `$replaceRoot`, `$count`, `$sortByCount`) stages. Raw stages (`$pipe`, `$bucket`, `$facet`, `$geoNear`, `$graphLookup`, `$setWindowFields`, `$searchMeta`) collapse the shape to `DocShape` and you opt back into types via the `pipe<NewShape>(...)` overload.
- **Field paths** in callbacks: `(f) => f.amount.eq(...)`, including nested dot-paths (`f('address.city')`) and the typed `rawPath('a.b')` escape hatch.
- **Terminal availability** via two phantom marker types — see [ADR 201](../architecture%20docs/adrs/ADR%20201%20-%20State-machine%20pattern%20for%20typed%20DSL%20builders.md) for the full marker table:
  - `UpdateEnabled` — gates the no-arg `.updateMany()` / `.updateOne()` form (consume the chain as an update-with-pipeline). Cleared by stages that produce content the `update` wire command cannot represent (`$group`, `$lookup`, `$limit`, `$skip`, `$sort`, …).
  - `FindAndModifyEnabled` — gates `.findOneAndUpdate(...)` / `.findOneAndDelete(...)`. Cleared by stages incompatible with the wire command's slots (`$skip`, `$limit`, `$group`, `$lookup`, mutating stages, …).
- **Result row type** for read terminals: computed from `Shape` and the contract's codec type maps. `null` is added to the row type for `findOneAndUpdate` / `findOneAndDelete`.

What is *not* statically guaranteed:

- **Filter value types** in the raw-AST form of `.match(filter)` — you can construct a `MongoFilterExpr` with any value. Use the callback form (`(f) => f.field.eq(...)`) to get full type checking.
- **Bucket / facet / geo / window options** — stage option objects are `MongoAggExpr` / `Record<string, unknown>` shaped where the typed accessor cannot reach. Consult the [MongoDB primitives reference](./mongodb-primitives-reference.md) for the wire-level shapes.
- **Atlas-only stage configs** (`$search`, `$vectorSearch`) — see *Known gaps*.

## Related

- [Subsystem 10 — MongoDB Family](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — architectural overview, state machine, lane contract.
- [ADR 183 — Aggregation pipeline only, never `find()` API](../architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md) — why there is no `find()` API.
- [Codec authoring guide](./codec-authoring-guide.md) — author codecs that flow through the builder's read/write surface.
- [MongoDB primitives reference](./mongodb-primitives-reference.md) — wire-level filter / expression / accumulator nodes.
