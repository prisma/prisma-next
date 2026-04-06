# Pipeline AST Completeness — Design

Design for extending the pipeline stage AST in `@prisma-next/mongo-query-ast` to cover the complete MongoDB aggregation pipeline. This eliminates the `Record<string, unknown>` escape hatch from `AggregatePipelineEntry`, making every pipeline stage a typed AST node.

**Companion docs:** [Aggregation expression AST](./aggregation-expression-ast-design.md), [Pipeline builder](./pipeline-builder-design.md).

**Precedent:** [Milestone 1 pipeline AST design](./milestone-1-pipeline-ast-design.md) — the existing stage AST and its design principles.

## Current state

The AST currently has 7 typed pipeline stages:

- `MongoMatchStage` — `$match` (filter documents)
- `MongoProjectStage` — `$project` (include/exclude fields, `Record<string, 0 | 1>`)
- `MongoSortStage` — `$sort` (order documents)
- `MongoLimitStage` — `$limit` (cap result count)
- `MongoSkipStage` — `$skip` (skip N documents)
- `MongoLookupStage` — `$lookup` (left outer join, equality form + optional nested pipeline)
- `MongoUnwindStage` — `$unwind` (deconstruct array field)

These are sufficient for the ORM's read queries. The union type `MongoReadStage` covers them. `AggregateCommand.pipeline` accepts `AggregatePipelineEntry = MongoReadStage | Record<string, unknown>`, where the `Record<string, unknown>` arm handles any stage the typed AST doesn't cover (e.g., `$group` in the existing aggregation test).

### What's missing

**Stages with no typed representation:** `$group`, `$addFields`/`$set`, `$replaceRoot`/`$replaceWith`, `$count`, `$sortByCount`, `$bucket`, `$bucketAuto`, `$facet`, `$graphLookup`, `$sample`, `$unionWith`, `$out`, `$merge`, `$redact`, `$geoNear`, `$setWindowFields`, `$densify`, `$fill`, `$search`, `$searchMeta`, `$vectorSearch`.

**Existing stages that need extension:**
- `MongoProjectStage` — currently only supports `0 | 1` inclusion/exclusion. Needs to support aggregation expressions for computed fields.
- `MongoLookupStage` — currently supports the equality form only. Needs to support the `let`/pipeline form for correlated sub-queries.
- `MongoUnwindStage` — missing the optional `includeArrayIndex` field.

**Structural issues:**
- `MongoReadStage` is named for read stages, but `$out` and `$merge` are write stages. The union should be renamed.
- `AggregatePipelineEntry` includes `Record<string, unknown>` — this should be eliminated once coverage is complete.
- The `MongoStageVisitor<R>` interface needs methods for all new stages.

## Design

### Rename `MongoReadStage` → `MongoPipelineStage`

The union type is renamed from `MongoReadStage` to `MongoPipelineStage` since the aggregation pipeline includes stages that aren't reads (`$out`, `$merge`, `$count`). Existing code that uses `MongoReadStage` is updated. `AggregateCommand.pipeline` becomes `ReadonlyArray<MongoPipelineStage>`.

### Eliminate `Record<string, unknown>` from `AggregatePipelineEntry`

After all stages have typed representations:

```typescript
// Before:
type AggregatePipelineEntry = MongoReadStage | Record<string, unknown>;

// After:
// AggregatePipelineEntry is removed entirely.
// AggregateCommand.pipeline becomes ReadonlyArray<MongoPipelineStage>.
```

### Extend existing stages

**`MongoProjectStage`** — support aggregation expressions for computed fields:

The projection value type changes from `0 | 1` to `0 | 1 | MongoAggExpr`:

```typescript
type MongoProjectionValue = 0 | 1 | MongoAggExpr;

class MongoProjectStage extends MongoStageNode {
  readonly kind = 'project' as const;
  readonly projection: Readonly<Record<string, MongoProjectionValue>>;
}
```

The ORM continues to pass `Record<string, 0 | 1>`, which is a subtype of `Record<string, MongoProjectionValue>` — no ORM changes needed.

Lowering: `0`/`1` values pass through directly; `MongoAggExpr` values are lowered via `lowerAggExpr()`.

This corresponds to MongoDB's `$project` behavior:

```javascript
{ $project: {
    name: 1,                                     // include as-is
    age: 0,                                      // exclude
    upperName: { $toUpper: "$name" },            // computed from expression
    fullName: { $concat: ["$first", " ", "$last"] }, // computed
    city: "$address.city",                       // field path (rename/extract)
} }
```

**`MongoLookupStage`** — support the `let`/pipeline form for correlated sub-queries:

```typescript
class MongoLookupStage extends MongoStageNode {
  readonly kind = 'lookup' as const;
  readonly from: string;
  readonly as: string;
  readonly localField: string | undefined;
  readonly foreignField: string | undefined;
  readonly let_: Readonly<Record<string, MongoAggExpr>> | undefined;
  readonly pipeline: ReadonlyArray<MongoPipelineStage> | undefined;
}
```

The equality form (`localField`/`foreignField`) and the pipeline form (`let_`/`pipeline`) can coexist. At least one form must be present.

This corresponds to MongoDB's pipeline lookup:

```javascript
{ $lookup: {
    from: "orders",
    let: { userId: "$_id" },
    pipeline: [
      { $match: { $expr: { $eq: ["$userId", "$$userId"] } } },
      { $sort: { createdAt: -1 } },
      { $limit: 5 }
    ],
    as: "recentOrders"
} }
```

Rewriting recurses into the `let_` expressions (via `MongoAggExprRewriter`) and the nested `pipeline` stages (via `MongoFilterRewriter` on each stage).

**`MongoUnwindStage`** — add `includeArrayIndex`:

```typescript
class MongoUnwindStage extends MongoStageNode {
  readonly kind = 'unwind' as const;
  readonly path: string;
  readonly preserveNullAndEmptyArrays: boolean;
  readonly includeArrayIndex: string | undefined;
}
```

### New stage classes

#### Data transformation stages

**`MongoGroupStage`** — group documents by key and apply accumulators:

```typescript
type MongoGroupId = null | MongoAggExpr | Readonly<Record<string, MongoAggExpr>>;

class MongoGroupStage extends MongoStageNode {
  readonly kind = 'group' as const;
  readonly groupId: MongoGroupId;
  readonly accumulators: Readonly<Record<string, MongoAggAccumulator>>;
}
```

`groupId` accepts three forms:
- `null` — group all documents into one group
- `MongoAggExpr` — group by a single expression (e.g., `MongoAggFieldRef("city")`)
- `Record<string, MongoAggExpr>` — compound grouping key (e.g., `{ city: fieldRef("city"), year: fieldRef("year") }`)

The `accumulators` field requires `MongoAggAccumulator` values specifically, not arbitrary `MongoAggExpr`. This enforces at the AST level that only accumulator operators appear in the accumulator positions.

Lowering maps `groupId` to `_id` and accumulators to their lowered forms:

```javascript
// AST: MongoGroupStage(fieldRef("city"), { count: accumulator("$sum", literal(1)) })
// Lowered: { $group: { _id: "$city", count: { $sum: 1 } } }
```

Rewriting recurses into the `groupId` expression(s) and each accumulator's argument expression.

**`MongoAddFieldsStage`** — add computed fields to documents:

```typescript
class MongoAddFieldsStage extends MongoStageNode {
  readonly kind = 'addFields' as const;
  readonly fields: Readonly<Record<string, MongoAggExpr>>;
}
```

`$addFields` and `$set` are aliases in MongoDB. The AST uses one class; lowering emits `$addFields`.

**`MongoReplaceRootStage`** — replace the root document:

```typescript
class MongoReplaceRootStage extends MongoStageNode {
  readonly kind = 'replaceRoot' as const;
  readonly newRoot: MongoAggExpr;
}
```

`$replaceRoot` and `$replaceWith` are aliases. The AST uses one class; lowering emits `$replaceRoot: { newRoot: ... }`.

**`MongoCountStage`** — count documents and output as a named field:

```typescript
class MongoCountStage extends MongoStageNode {
  readonly kind = 'count' as const;
  readonly field: string;
}
```

Output is a single document: `{ [field]: <count> }`.

**`MongoSortByCountStage`** — group by expression value, count, and sort descending:

```typescript
class MongoSortByCountStage extends MongoStageNode {
  readonly kind = 'sortByCount' as const;
  readonly expr: MongoAggExpr;
}
```

Sugar for `$group: { _id: expr, count: { $sum: 1 } }` followed by `$sort: { count: -1 }`.

**`MongoRedactStage`** — restrict document content based on field-level conditions:

```typescript
class MongoRedactStage extends MongoStageNode {
  readonly kind = 'redact' as const;
  readonly expr: MongoAggExpr;
}
```

The expression must evaluate to `$$DESCEND`, `$$PRUNE`, or `$$KEEP`.

**`MongoSampleStage`** — randomly select N documents:

```typescript
class MongoSampleStage extends MongoStageNode {
  readonly kind = 'sample' as const;
  readonly size: number;
}
```

#### Join and multi-collection stages

**`MongoGraphLookupStage`** — recursive graph traversal:

```typescript
class MongoGraphLookupStage extends MongoStageNode {
  readonly kind = 'graphLookup' as const;
  readonly from: string;
  readonly startWith: MongoAggExpr;
  readonly connectFromField: string;
  readonly connectToField: string;
  readonly as: string;
  readonly maxDepth: number | undefined;
  readonly depthField: string | undefined;
  readonly restrictSearchWithMatch: MongoFilterExpr | undefined;
}
```

**`MongoUnionWithStage`** — combine documents from another collection:

```typescript
class MongoUnionWithStage extends MongoStageNode {
  readonly kind = 'unionWith' as const;
  readonly collection: string;
  readonly pipeline: ReadonlyArray<MongoPipelineStage> | undefined;
}
```

#### Bucketing stages

**`MongoBucketStage`** — group documents into user-defined buckets:

```typescript
class MongoBucketStage extends MongoStageNode {
  readonly kind = 'bucket' as const;
  readonly groupBy: MongoAggExpr;
  readonly boundaries: ReadonlyArray<MongoValue>;
  readonly default_: MongoValue | undefined;
  readonly output: Readonly<Record<string, MongoAggAccumulator>> | undefined;
}
```

**`MongoBucketAutoStage`** — automatically distribute documents into N buckets:

```typescript
class MongoBucketAutoStage extends MongoStageNode {
  readonly kind = 'bucketAuto' as const;
  readonly groupBy: MongoAggExpr;
  readonly buckets: number;
  readonly output: Readonly<Record<string, MongoAggAccumulator>> | undefined;
  readonly granularity: string | undefined;
}
```

#### Multi-pipeline stages

**`MongoFacetStage`** — run multiple sub-pipelines in parallel:

```typescript
class MongoFacetStage extends MongoStageNode {
  readonly kind = 'facet' as const;
  readonly facets: Readonly<Record<string, ReadonlyArray<MongoPipelineStage>>>;
}
```

Each facet key maps to an independent sub-pipeline. The output is a single document where each key contains the sub-pipeline's result array.

**`MongoSetWindowFieldsStage`** — window functions:

```typescript
interface MongoWindowField {
  readonly expr: MongoAggAccumulator;
  readonly window: MongoWindowSpec | undefined;
}

interface MongoWindowSpec {
  readonly documents: readonly [number, number] | undefined;
  readonly range: readonly [number | 'unbounded' | 'current', number | 'unbounded' | 'current'] | undefined;
  readonly unit: string | undefined;
}

class MongoSetWindowFieldsStage extends MongoStageNode {
  readonly kind = 'setWindowFields' as const;
  readonly partitionBy: MongoAggExpr | undefined;
  readonly sortBy: Readonly<Record<string, 1 | -1>> | undefined;
  readonly output: Readonly<Record<string, MongoWindowField>>;
}
```

#### Output stages (terminal)

**`MongoOutStage`** — write pipeline results to a collection (replaces existing content):

```typescript
class MongoOutStage extends MongoStageNode {
  readonly kind = 'out' as const;
  readonly collection: string;
  readonly db: string | undefined;
}
```

**`MongoMergeStage`** — merge pipeline results into a collection:

```typescript
class MongoMergeStage extends MongoStageNode {
  readonly kind = 'merge' as const;
  readonly into: string | { readonly db: string; readonly coll: string };
  readonly on: string | ReadonlyArray<string> | undefined;
  readonly whenMatched: 'replace' | 'keepExisting' | 'merge' | 'fail' | ReadonlyArray<MongoPipelineStage> | undefined;
  readonly whenNotMatched: 'insert' | 'discard' | 'fail' | undefined;
}
```

#### Geospatial

**`MongoGeoNearStage`** — proximity-based sort (must be first stage in pipeline):

```typescript
class MongoGeoNearStage extends MongoStageNode {
  readonly kind = 'geoNear' as const;
  readonly near: Record<string, unknown>;
  readonly distanceField: string;
  readonly spherical: boolean | undefined;
  readonly maxDistance: number | undefined;
  readonly minDistance: number | undefined;
  readonly query: MongoFilterExpr | undefined;
  readonly distanceMultiplier: number | undefined;
  readonly includeLocs: string | undefined;
  readonly key: string | undefined;
}
```

#### Time series / gap filling

**`MongoDensifyStage`** — fill gaps in sequences:

```typescript
class MongoDensifyStage extends MongoStageNode {
  readonly kind = 'densify' as const;
  readonly field: string;
  readonly partitionByFields: ReadonlyArray<string> | undefined;
  readonly range: {
    readonly step: number;
    readonly unit: string | undefined;
    readonly bounds: 'full' | 'partition' | readonly [unknown, unknown];
  };
}
```

**`MongoFillStage`** — fill missing field values:

```typescript
class MongoFillStage extends MongoStageNode {
  readonly kind = 'fill' as const;
  readonly partitionBy: MongoAggExpr | undefined;
  readonly partitionByFields: ReadonlyArray<string> | undefined;
  readonly sortBy: Readonly<Record<string, 1 | -1>> | undefined;
  readonly output: Readonly<Record<string, { readonly method: string } | { readonly value: MongoAggExpr }>>;
}
```

#### Atlas-specific stages

**`MongoSearchStage`** — Atlas full-text search:

```typescript
class MongoSearchStage extends MongoStageNode {
  readonly kind = 'search' as const;
  readonly index: string | undefined;
  readonly config: Readonly<Record<string, unknown>>;
}
```

The `config` is an opaque record because Atlas Search operators (`text`, `compound`, `autocomplete`, `phrase`, `wildcard`, etc.) form a complex, independently-versioned query language. The AST captures the stage boundary; the contents are passed through.

**`MongoSearchMetaStage`** — Atlas search metadata:

```typescript
class MongoSearchMetaStage extends MongoStageNode {
  readonly kind = 'searchMeta' as const;
  readonly index: string | undefined;
  readonly config: Readonly<Record<string, unknown>>;
}
```

**`MongoVectorSearchStage`** — Atlas vector search:

```typescript
class MongoVectorSearchStage extends MongoStageNode {
  readonly kind = 'vectorSearch' as const;
  readonly index: string;
  readonly path: string;
  readonly queryVector: ReadonlyArray<number>;
  readonly numCandidates: number;
  readonly limit: number;
  readonly filter: Readonly<Record<string, unknown>> | undefined;
}
```

### Updated `MongoPipelineStage` union

```typescript
type MongoPipelineStage =
  // Filter & sort:
  | MongoMatchStage
  | MongoSortStage
  | MongoLimitStage
  | MongoSkipStage
  // Projection & reshaping:
  | MongoProjectStage
  | MongoAddFieldsStage
  | MongoReplaceRootStage
  | MongoUnwindStage
  // Grouping & aggregation:
  | MongoGroupStage
  | MongoCountStage
  | MongoSortByCountStage
  | MongoBucketStage
  | MongoBucketAutoStage
  | MongoFacetStage
  | MongoSetWindowFieldsStage
  // Joins & multi-collection:
  | MongoLookupStage
  | MongoGraphLookupStage
  | MongoUnionWithStage
  // Sampling & redaction:
  | MongoSampleStage
  | MongoRedactStage
  // Output (terminal):
  | MongoOutStage
  | MongoMergeStage
  // Geospatial:
  | MongoGeoNearStage
  // Time series:
  | MongoDensifyStage
  | MongoFillStage
  // Atlas-specific:
  | MongoSearchStage
  | MongoSearchMetaStage
  | MongoVectorSearchStage;
```

### Updated `MongoStageVisitor<R>`

The visitor gains a method for each new stage kind. It remains exhaustive — every stage must be handled:

```typescript
interface MongoStageVisitor<R> {
  // Existing:
  match(stage: MongoMatchStage): R;
  project(stage: MongoProjectStage): R;
  sort(stage: MongoSortStage): R;
  limit(stage: MongoLimitStage): R;
  skip(stage: MongoSkipStage): R;
  lookup(stage: MongoLookupStage): R;
  unwind(stage: MongoUnwindStage): R;
  // New — data transformation:
  group(stage: MongoGroupStage): R;
  addFields(stage: MongoAddFieldsStage): R;
  replaceRoot(stage: MongoReplaceRootStage): R;
  count(stage: MongoCountStage): R;
  sortByCount(stage: MongoSortByCountStage): R;
  redact(stage: MongoRedactStage): R;
  sample(stage: MongoSampleStage): R;
  // New — joins & multi-collection:
  graphLookup(stage: MongoGraphLookupStage): R;
  unionWith(stage: MongoUnionWithStage): R;
  // New — bucketing:
  bucket(stage: MongoBucketStage): R;
  bucketAuto(stage: MongoBucketAutoStage): R;
  // New — multi-pipeline:
  facet(stage: MongoFacetStage): R;
  setWindowFields(stage: MongoSetWindowFieldsStage): R;
  // New — output:
  out(stage: MongoOutStage): R;
  merge(stage: MongoMergeStage): R;
  // New — geospatial:
  geoNear(stage: MongoGeoNearStage): R;
  // New — time series:
  densify(stage: MongoDensifyStage): R;
  fill(stage: MongoFillStage): R;
  // New — Atlas:
  search(stage: MongoSearchStage): R;
  searchMeta(stage: MongoSearchMetaStage): R;
  vectorSearch(stage: MongoVectorSearchStage): R;
}
```

### Stage rewriter

The existing stages use `rewrite(rewriter: MongoFilterRewriter)` to recurse into embedded filter expressions (currently only `MongoMatchStage` and `MongoLookupStage.pipeline` have filters).

New stages introduce two additional rewriting concerns:

1. **Aggregation expressions** — stages like `$group`, `$addFields`, `$project` (computed), `$bucket`, `$replaceRoot` contain `MongoAggExpr` nodes that may need rewriting.
2. **Nested pipelines** — stages like `$facet`, `$unionWith`, `$merge` (when `whenMatched` is a pipeline), and the extended `$lookup` contain nested `MongoPipelineStage[]`.

The `rewrite()` method on each stage recurses into all embedded expressions and nested pipelines using the appropriate rewriter. Stages that contain only scalar data (sort specs, limits, field names) return `this`.

### Lowering

Lowering for new stages follows the same visitor-based pattern as existing stages. Each stage kind maps to a single MongoDB document:

| Stage | Lowered form |
|-------|-------------|
| `MongoGroupStage` | `{ $group: { _id: lower(groupId), ...mapValues(lowerAccum, accumulators) } }` |
| `MongoAddFieldsStage` | `{ $addFields: mapValues(lowerAggExpr, fields) }` |
| `MongoReplaceRootStage` | `{ $replaceRoot: { newRoot: lowerAggExpr(newRoot) } }` |
| `MongoCountStage` | `{ $count: field }` |
| `MongoSortByCountStage` | `{ $sortByCount: lowerAggExpr(expr) }` |
| `MongoSampleStage` | `{ $sample: { size: size } }` |
| `MongoFacetStage` | `{ $facet: mapValues(lowerPipeline, facets) }` |
| `MongoOutStage` | `{ $out: collection }` or `{ $out: { db, coll } }` |
| `MongoMergeStage` | `{ $merge: { into, on?, whenMatched?, whenNotMatched? } }` |
| ... | (remaining stages follow the same pattern) |

Stages containing `MongoAggExpr` fields call `lowerAggExpr()` (from the aggregation expression AST). Stages containing `MongoFilterExpr` fields call the existing `lowerFilter()`. Stages containing nested pipelines call `lowerPipeline()` recursively.

## Pipeline-style updates (computed writes)

MongoDB 4.2+ supports passing an aggregation pipeline as the `update` parameter to `updateOne`, `updateMany`, and `findOneAndUpdate`. Only a subset of pipeline stages are valid in this context:

| Update-compatible stage | AST class | Purpose |
|------------------------|-----------|---------|
| `$addFields` / `$set` | `MongoAddFieldsStage` | Set fields to computed values |
| `$unset` | (implicit via `MongoProjectStage` with `0`) | Remove fields |
| `$replaceRoot` / `$replaceWith` | `MongoReplaceRootStage` | Replace the entire document |
| `$project` | `MongoProjectStage` | Reshape the document |

These stages contain `MongoAggExpr` nodes, meaning the aggregation expression AST is shared infrastructure for both read pipelines and computed writes.

### Update command changes

The update commands currently accept only traditional operator-style updates:

```typescript
// Current: traditional operators only
readonly update: Record<string, MongoValue>;
```

To support pipeline-style updates, the update commands gain a union type:

```typescript
type MongoUpdateSpec =
  | Record<string, MongoValue>                     // traditional: { $set: {...}, $inc: {...} }
  | ReadonlyArray<MongoUpdatePipelineStage>;        // pipeline: [{ $set: {...} }, { $unset: [...] }]

type MongoUpdatePipelineStage =
  | MongoAddFieldsStage
  | MongoProjectStage
  | MongoReplaceRootStage;
```

`UpdateOneCommand`, `UpdateManyCommand`, and `FindOneAndUpdateCommand` change their `update` field from `Record<string, MongoValue>` to `MongoUpdateSpec`. Existing ORM code that passes `{ $set: {...} }` continues to work — `Record<string, MongoValue>` is still a valid arm of the union.

### Adapter lowering for pipeline-style updates

The adapter's `lowerCommand` dispatches based on whether the update is an array (pipeline) or an object (traditional operators):

- **Traditional**: lower filter, pass update document through as-is (existing behavior)
- **Pipeline**: lower filter, then lower each `MongoUpdatePipelineStage` via the same `lowerStage()` function used for read pipelines

The wire commands (`UpdateOneWireCommand`, `UpdateManyWireCommand`, `FindOneAndUpdateWireCommand`) already accept `Document` for the update field. The MongoDB driver accepts both forms natively — `{ $set: {...} }` for traditional and `[{ $set: {...} }]` for pipeline-style.

### Value-add

This is a significant capability gain. Traditional update operators can only set fields to literal values. Pipeline-style updates enable:

- **Cross-field references**: `{ $set: { fullName: { $concat: ["$first", " ", "$last"] } } }`
- **Conditional logic**: `{ $set: { tier: { $cond: { if: { $gte: ["$score", 100] }, then: "gold", else: "silver" } } } }`
- **Arithmetic from existing values**: `{ $set: { total: { $multiply: ["$price", "$quantity"] } } }`
- **Date computations**: `{ $set: { renewalDate: { $dateAdd: { startDate: "$expiresAt", unit: "month", amount: 1 } } } }`

All of these use the same `MongoAggExpr` nodes designed in [Aggregation expression AST design](./aggregation-expression-ast-design.md). The expression AST, its visitors, rewriters, and lowering logic serve both read pipelines and computed writes without duplication.

## Impact on existing consumers

### ORM (`MongoCollection`)

The ORM's `compileMongoQuery` produces `AggregateCommand` with a pipeline of typed stages. After this change:

- `AggregateCommand.pipeline` type changes from `ReadonlyArray<AggregatePipelineEntry>` to `ReadonlyArray<MongoPipelineStage>`
- The ORM already produces typed stages (`MongoMatchStage`, `MongoProjectStage`, etc.), so the runtime behavior is unchanged
- `MongoProjectStage`'s field type widens from `Record<string, 0 | 1>` to `Record<string, MongoProjectionValue>`, but the ORM still passes `0 | 1` values — no code changes needed
- Update commands (`UpdateOneCommand`, `UpdateManyCommand`, `FindOneAndUpdateCommand`) widen from `Record<string, MongoValue>` to `MongoUpdateSpec`. The ORM continues to pass traditional operator documents — no code changes needed. Pipeline-style updates become available to the pipeline builder and advanced users.

### Adapter lowering

The adapter's `lowerPipeline` function currently handles typed stages via `lowerStage()` and raw stages via direct pass-through. After this change:

- The raw pass-through branch is removed
- `lowerStage()` gains cases for all new stage kinds
- Aggregation expression lowering (`lowerAggExpr`) is called from within stage lowering for stages that contain expressions
- `lowerCommand` for update commands gains a pipeline branch that reuses `lowerStage()` for each `MongoUpdatePipelineStage`

### Runtime aggregate test

The existing `aggregate.test.ts` constructs `AggregateCommand` with raw `Record<string, unknown>` pipeline entries (e.g., `{ $group: ... }`). After this change, these tests are updated to use typed stage classes (e.g., `new MongoGroupStage(...)`).

## References

- [Milestone 1 pipeline AST design](./milestone-1-pipeline-ast-design.md) — existing stage and filter expression AST
- [Aggregation expression AST design](./aggregation-expression-ast-design.md) — companion doc for expressions used within stages
- [Pipeline builder design](./pipeline-builder-design.md) — companion doc for the query builder that consumes these stages
- [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [MongoDB aggregation pipeline stages reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation-pipeline/)
