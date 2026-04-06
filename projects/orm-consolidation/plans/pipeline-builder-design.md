# Pipeline Query Builder — Design

Design for a type-safe, contract-aware aggregation pipeline builder for MongoDB. The builder is the escape-hatch equivalent of the SQL query builder (`sql().from(...).select(...)`) — a lower-level surface for queries the ORM can't express.

**Companion docs:** [Aggregation expression AST](./aggregation-expression-ast-design.md), [Pipeline AST completeness](./pipeline-ast-completeness-design.md).

**Linear:** [TML-2207](https://linear.app/prisma-company/issue/TML-2207).

**Precedent:** The SQL query builder (`@prisma-next/sql-builder`) — fluent API, immutable state, `BuilderState` → `SqlQueryPlan`, type-level `Scope`/`ScopeField`/`ResolveRow` pattern.

## Raw pipeline — the first vertical slice

Before the typed builder, we ship a minimal **raw pipeline** API that executes a plain array of MongoDB pipeline stage documents against a collection. This is the Mongo equivalent of raw SQL queries — it validates the execution path end-to-end and gives users an immediate escape hatch for any aggregation the ORM can't express.

### Why start here

1. **Already works at the wire level** — `AggregateWireCommand` accepts `RawPipeline` (`ReadonlyArray<Record<string, unknown>>`), and the driver already calls `collection.aggregate(pipeline)`. The plumbing exists; we're adding a user-facing API.
2. **Validates the full stack** — executing a raw pipeline exercises contract lookup, collection resolution, runtime dispatch, adapter lowering, and result streaming. Any integration issues surface immediately.
3. **Zero AST dependency** — ships before the aggregation expression AST or typed stage work. Users can write pipelines today using plain objects.
4. **Incremental typing** — once the typed stage AST lands, users can mix raw stages and typed stages in the same pipeline via `.pipe()`.

### User-facing API

```typescript
const db = mongo<Contract, TypeMaps>({ contractJson, url });

// Raw pipeline — no type inference, returns unknown documents
const results = db.rawPipeline('orders', [
  { $match: { status: 'completed' } },
  { $group: { _id: '$customerId', total: { $sum: '$amount' } } },
  { $sort: { total: -1 } },
  { $limit: 10 },
]);

// With type assertion — user provides the expected row type
const topCustomers = db.rawPipeline<{ _id: string; total: number }>('orders', [
  { $match: { status: 'completed' } },
  { $group: { _id: '$customerId', total: { $sum: '$amount' } } },
  { $sort: { total: -1 } },
  { $limit: 10 },
]);

for await (const customer of topCustomers) {
  console.log(customer._id, customer.total);
  //          ^string       ^number — user-asserted types
}
```

### Implementation

```typescript
interface MongoClient<C extends MongoContractWithTypeMaps> {
  rawPipeline<Row = Record<string, unknown>>(
    collection: string & keyof C['models'],
    stages: ReadonlyArray<Record<string, unknown>>,
  ): AsyncIterableResult<Row>;
}
```

Internally, `rawPipeline` constructs an `AggregateCommand` with the raw stages and executes it through the existing `MongoRuntime` → adapter → driver path. The collection name is validated against the contract (must be a known model or storage-mapped collection).

### Relationship to the typed builder

The raw pipeline and typed builder are complementary:

- **Raw pipeline**: no type inference, any valid MongoDB pipeline, user is responsible for correctness
- **Typed builder**: full type inference, field references checked against document shape, output type tracks transformations

The builder's `.pipe()` escape hatch bridges the two — users can inject raw `MongoPipelineStage` nodes into a typed pipeline when the builder doesn't have a method for a specific stage.

## What the builder does

The ORM surfaces model-centric CRUD operations (`where`, `select`, `include`, `create`, `update`, `delete`). It compiles to aggregation pipelines internally, but the user thinks in model terms, not pipeline terms.

The pipeline builder surfaces MongoDB's aggregation pipeline directly. The user thinks in pipeline stages — `$match`, `$group`, `$project`, `$addFields`, `$unwind`, `$lookup`, `$facet`. Each stage receives the output of the previous stage and transforms the document stream. The builder's job is to make this composition type-safe: field references are checked against the current document shape, and the output type reflects all transformations.

The core technical challenge is **tracking how the document shape transforms through the pipeline at the type level**. A `$group` stage produces a completely new document shape from its `_id` expression and accumulators. A `$project` narrows the shape to included and computed fields. An `$addFields` extends the shape. A `$unwind` replaces an array field with its element type. The builder's type parameters must evolve through each of these transformations.

## Document shape tracking

### DocField and DocShape

The builder tracks the current document shape as a type parameter. Each field in the shape carries its codec identity and nullability, following the SQL builder's `ScopeField` pattern:

```typescript
interface DocField {
  readonly codecId: string;
  readonly nullable: boolean;
}

type DocShape = Record<string, DocField>;
```

The initial `DocShape` when entering via `from(collection)` is derived from the contract's model definition:

```typescript
type ModelToDocShape<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [FieldName in keyof TContract['models'][ModelName]['fields'] & string]: {
    readonly codecId: TContract['models'][ModelName]['fields'][FieldName]['codecId'];
    readonly nullable: TContract['models'][ModelName]['fields'][FieldName]['nullable'];
  };
};
```

### Resolving to concrete types

At `.build()` time, `DocShape` is resolved to concrete TypeScript types using `ResolveRow`, exactly as in the SQL builder:

```typescript
type ResolveRow<
  Shape extends DocShape,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = Expand<{
  -readonly [K in keyof Shape]: Shape[K]['codecId'] extends keyof CodecTypes
    ? Shape[K]['nullable'] extends true
      ? CodecTypes[Shape[K]['codecId']]['output'] | null
      : CodecTypes[Shape[K]['codecId']]['output']
    : unknown;
}>;
```

Each `DocField.codecId` maps to the codec's TypeScript output type via the contract's `CodecTypes` type map. Nullable fields gain `| null`.

### How stages transform the shape

Each pipeline stage produces a new `DocShape`. The transformations fall into four categories:

**Identity** — the shape passes through unchanged:

```
match, sort, limit, skip, sample, redact
```

`PipelineBuilder<QC, S>` → `PipelineBuilder<QC, S>`

**Additive** — new fields are added to the existing shape:

```
addFields:  S → S & { [k]: FieldTypeOf<expr> }
lookup:     S → S & { [as]: ArrayDocField }
```

`PipelineBuilder<QC, S>` → `PipelineBuilder<QC, S & NewFields>`

**Narrowing** — the shape is reduced or partially replaced:

```
project (inclusion):   S → Pick<S, IncludedKeys | '_id'>
project (with exprs):  S → Pick<S, IncludedKeys | '_id'> & { [k]: FieldTypeOf<expr> }
unwind:                S → S with S[K] unwound from array to element
```

`PipelineBuilder<QC, S>` → `PipelineBuilder<QC, NarrowedS>`

**Replacement** — the shape is completely new, no relationship to the previous shape:

```
group:         S → { _id: IdFieldType, [k]: AccumulatorOutputType }
replaceRoot:   S → ShapeOf<expr>
count:         S → { [field]: NumberDocField }
sortByCount:   S → { _id: FieldTypeOf<expr>, count: NumberDocField }
```

`PipelineBuilder<QC, S>` → `PipelineBuilder<QC, NewS>`

### Typed expressions carry their output type

For the builder to compute the new `DocShape` after a `$group`, `$project`, or `$addFields`, expressions must carry their output type. The AST's `MongoAggExpr` is contract-agnostic (it doesn't know about codecs or TypeScript types), so the builder wraps it in a typed envelope:

```typescript
interface TypedAggExpr<F extends DocField> {
  readonly _field: F;
  readonly node: MongoAggExpr;
}
```

The `_field` phantom type parameter lets the builder's type system extract the output type of each expression and use it to compute the new `DocShape`.

Builder-level helpers (`acc.sum()`, `fn.concat()`, `field()`) return `TypedAggExpr<F>` with the correct `F` type:

```typescript
// field("city") when city has codecId 'string' → TypedAggExpr<{ codecId: 'string', nullable: false }>
// acc.sum(expr) → TypedAggExpr<{ codecId: 'double', nullable: false }>
// acc.avg(expr) → TypedAggExpr<{ codecId: 'double', nullable: true }>
// fn.concat(a, b) → TypedAggExpr<{ codecId: 'string', nullable: false }>
```

These are builder-level constructs, not AST constructs. The AST remains contract-agnostic; the type information is a layer on top.

## Worked example: e-commerce order analytics

Before diving into the API surface, here's a complete example showing how the pieces fit together. This query answers "for each product category, what are the top 3 customers by spending, including their average order value?"

### The contract models

```typescript
// Simplified contract with three models:
model Order {
  _id        ObjectId
  customerId ObjectId
  items      OrderItem[]   // embedded array of { productId, category, price, quantity }
  status     String        // "pending" | "completed" | "cancelled"
  createdAt  DateTime
}

model Customer {
  _id    ObjectId
  name   String
  email  String
  tier   String          // "bronze" | "silver" | "gold"
}

model OrderItem {
  productId  ObjectId
  category   String
  price      Double
  quantity   Int
}
```

### The pipeline

```typescript
const pipeline = mongoPipeline({ context });

const result = pipeline
  // Start from orders — DocShape is { _id, customerId, items, status, createdAt }
  .from('orders')

  // 1. Filter to completed orders
  .match(f => f.status.eq('completed'))
  // DocShape unchanged: { _id, customerId, items, status, createdAt }

  // 2. Unwind the items array — one document per line item
  .unwind('items')
  // DocShape: { _id, customerId, items: { productId, category, price, quantity }, status, createdAt }
  // items changed from OrderItem[] to OrderItem

  // 3. Compute the line total for each item
  .addFields((fields, fn) => ({
    lineTotal: fn.multiply(fields.items.price, fields.items.quantity),
  }))
  // DocShape: { ..., lineTotal: number }

  // 4. Group by category + customer, sum their spending
  .group((fields, acc) => ({
    _id: { category: fields.items.category, customerId: fields.customerId },
    totalSpent: acc.sum(fields.lineTotal),
    orderCount: acc.count(),
    avgOrderValue: acc.avg(fields.lineTotal),
  }))
  // DocShape: { _id: { category: string, customerId: ObjectId }, totalSpent: number, orderCount: number, avgOrderValue: number | null }
  // Previous shape is completely replaced

  // 5. Sort by category ascending, then spending descending
  .sort({ '_id.category': 1, totalSpent: -1 })

  // 6. Re-group by category to collect ranked customers
  .group((fields, acc) => ({
    _id: fields._id.category,
    customers: acc.push({
      customerId: fields._id.customerId,
      totalSpent: fields.totalSpent,
      orderCount: fields.orderCount,
      avgOrderValue: fields.avgOrderValue,
    }),
  }))
  // DocShape: { _id: string, customers: Array<{ customerId, totalSpent, orderCount, avgOrderValue }> }

  // 7. Slice to top 3 per category (via $project with $slice expression)
  .project((fields, fn) => ({
    category: fields._id,
    topCustomers: fn.slice(fields.customers, 3),
  }))
  // DocShape: { _id: ObjectId, category: string, topCustomers: Array<...> }

  // 8. Look up customer names
  .unwind('topCustomers')
  .lookup({
    from: 'customers',
    localField: 'topCustomers.customerId',
    foreignField: '_id',
    as: 'customerInfo',
  })
  .unwind('customerInfo')

  // 9. Project the final shape
  .project((fields) => ({
    category: fields.category,
    customerName: fields.customerInfo.name,
    customerEmail: fields.customerInfo.email,
    totalSpent: fields.topCustomers.totalSpent,
    orderCount: fields.topCustomers.orderCount,
    avgOrderValue: fields.topCustomers.avgOrderValue,
  }))

  .execute();
// AsyncIterableResult<{
//   _id: ObjectId,
//   category: string,
//   customerName: string,
//   customerEmail: string,
//   totalSpent: number,
//   orderCount: number,
//   avgOrderValue: number | null,
// }>
```

### What this demonstrates

1. **Shape tracking through the pipeline**: each stage comment shows how `DocShape` evolves. The type system catches errors like referencing `fields.status` after a `$group` that replaced the shape.
2. **Additive, narrowing, and replacement transformations**: `$addFields` extends the shape, `$project` narrows it, `$group` replaces it entirely.
3. **Cross-collection traversal**: `$lookup` introduces the `customers` collection's fields into the pipeline.
4. **Nested field access**: `fields.items.price` and `fields._id.category` navigate into embedded documents and compound group keys.
5. **Expression composition**: `fn.multiply(fields.items.price, fields.items.quantity)` constructs a `MongoAggExpr` tree with the correct output type.
6. **Type safety end-to-end**: the final `execute()` return type reflects all transformations — no manual type annotation needed.

### Equivalent raw pipeline

For comparison, here's the same query using the raw pipeline API. No type safety, but works immediately:

```typescript
const result = db.rawPipeline<{
  category: string;
  customerName: string;
  totalSpent: number;
  orderCount: number;
  avgOrderValue: number;
}>('orders', [
  { $match: { status: 'completed' } },
  { $unwind: '$items' },
  { $addFields: { lineTotal: { $multiply: ['$items.price', '$items.quantity'] } } },
  { $group: {
    _id: { category: '$items.category', customerId: '$customerId' },
    totalSpent: { $sum: '$lineTotal' },
    orderCount: { $sum: 1 },
    avgOrderValue: { $avg: '$lineTotal' },
  }},
  { $sort: { '_id.category': 1, totalSpent: -1 } },
  { $group: {
    _id: '$_id.category',
    customers: { $push: {
      customerId: '$_id.customerId', totalSpent: '$totalSpent',
      orderCount: '$orderCount', avgOrderValue: '$avgOrderValue',
    }},
  }},
  { $project: { category: '$_id', topCustomers: { $slice: ['$customers', 3] } } },
  { $unwind: '$topCustomers' },
  { $lookup: { from: 'customers', localField: 'topCustomers.customerId', foreignField: '_id', as: 'customerInfo' } },
  { $unwind: '$customerInfo' },
  { $project: {
    category: 1, customerName: '$customerInfo.name', customerEmail: '$customerInfo.email',
    totalSpent: '$topCustomers.totalSpent', orderCount: '$topCustomers.orderCount',
    avgOrderValue: '$topCustomers.avgOrderValue',
  }},
]);
```

The raw version works but offers no compile-time safety — a typo in `'$items.proce'` or referencing a field that a previous `$group` eliminated would only fail at runtime.

## Builder API

### Entry point

The builder is accessed through a factory function that takes the execution context (contract + codec types + executor):

```typescript
function mongoPipeline<C extends MongoContractWithTypeMaps>(options: {
  context: MongoExecutionContext<C>;
}): PipelineRoot<C>;
```

`PipelineRoot<C>` provides access to collections, either via a `from()` method or proxy-based property access (following the SQL builder's pattern):

```typescript
const pipeline = mongoPipeline({ context });

// Start a pipeline on the 'users' collection:
pipeline.from('users')    // PipelineBuilder<QC, UserDocShape>
// or:
pipeline.users            // PipelineBuilder<QC, UserDocShape>
```

The initial `DocShape` is `ModelToDocShape<C, ModelName>` — field names and types derived from the contract's model definition.

### Fluent chaining

Each stage method returns a new `PipelineBuilder` with an updated `DocShape` type parameter. The runtime state is immutable — each method clones the state and appends a stage, following the SQL builder's `cloneState()` pattern.

```typescript
class PipelineBuilder<QC extends QueryContext, Shape extends DocShape> {

  // --- Identity stages ---

  match(filter: MongoFilterExpr): PipelineBuilder<QC, Shape>;
  match(fn: (fields: FilterProxy<Shape>) => MongoFilterExpr): PipelineBuilder<QC, Shape>;

  sort(spec: SortSpec<Shape>): PipelineBuilder<QC, Shape>;
  limit(n: number): PipelineBuilder<QC, Shape>;
  skip(n: number): PipelineBuilder<QC, Shape>;
  sample(n: number): PipelineBuilder<QC, Shape>;

  // --- Additive stages ---

  addFields<NewFields extends Record<string, TypedAggExpr<DocField>>>(
    fn: (fields: FieldProxy<Shape>) => NewFields,
  ): PipelineBuilder<QC, Shape & ExtractDocShape<NewFields>>;

  lookup<As extends string, ForeignModel extends string & keyof QC['contract']['models']>(
    options: LookupOptions<Shape, ForeignModel, As>,
  ): PipelineBuilder<QC, Shape & Record<As, ArrayDocField>>;

  // --- Narrowing stages ---

  project<Keys extends (keyof Shape & string)[]>(
    ...keys: Keys
  ): PipelineBuilder<QC, Pick<Shape, Keys[number] | '_id'>>;

  project<Spec extends Record<string, 1 | TypedAggExpr<DocField>>>(
    fn: (fields: FieldProxy<Shape>) => Spec,
  ): PipelineBuilder<QC, ProjectedShape<Shape, Spec>>;

  unwind<K extends ArrayFieldKeys<Shape>>(
    field: K,
  ): PipelineBuilder<QC, UnwoundShape<Shape, K>>;

  // --- Replacement stages ---

  group<Spec extends GroupSpec>(
    fn: (fields: FieldProxy<Shape>, acc: AccumulatorHelpers) => Spec,
  ): PipelineBuilder<QC, GroupedDocShape<Spec>>;

  replaceRoot<NewShape extends DocShape>(
    fn: (fields: FieldProxy<Shape>) => TypedAggExpr<EmbeddedDocField<NewShape>>,
  ): PipelineBuilder<QC, NewShape>;

  count<F extends string>(
    field: F,
  ): PipelineBuilder<QC, Record<F, { codecId: 'int'; nullable: false }>>;

  sortByCount(
    fn: (fields: FieldProxy<Shape>) => TypedAggExpr<DocField>,
  ): PipelineBuilder<QC, { _id: DocField; count: { codecId: 'int'; nullable: false } }>;

  // --- Multi-pipeline stages ---

  facet<Facets extends Record<string, (builder: PipelineBuilder<QC, Shape>) => PipelineBuilder<QC, DocShape>>>(
    facets: Facets,
  ): PipelineBuilder<QC, FacetDocShape<Facets>>;

  // --- Raw escape hatch ---

  pipe(stage: MongoPipelineStage): PipelineBuilder<QC, Shape>;
  pipe<NewShape extends DocShape>(stage: MongoPipelineStage): PipelineBuilder<QC, NewShape>;

  // --- Terminal methods ---

  build(): MongoQueryPlan<ResolveRow<Shape, QC['codecTypes']>>;
  execute(): AsyncIterableResult<ResolveRow<Shape, QC['codecTypes']>>;
}
```

### Field references via callbacks

The key ergonomic pattern: stage methods that need field references accept callbacks that receive typed proxies. The proxy exposes each field in the current document shape as a `TypedAggExpr`, giving autocomplete and type checking.

```typescript
type FieldProxy<Shape extends DocShape> = {
  [K in keyof Shape & string]: TypedAggExpr<Shape[K]>;
};
```

Inside a callback, `fields.age` is a `TypedAggExpr<{ codecId: 'int', nullable: false }>` — it carries both the AST node (a `MongoAggFieldRef`) and the type information needed for the builder to compute the output shape.

For `match`, a separate `FilterProxy` exposes filter-expression methods (`.eq()`, `.gt()`, etc.) since filter expressions are structurally different from aggregation expressions:

```typescript
type FilterProxy<Shape extends DocShape> = {
  [K in keyof Shape & string]: FieldFilterMethods<Shape[K]>;
};

interface FieldFilterMethods<F extends DocField> {
  eq(value: ResolveFieldType<F>): MongoFilterExpr;
  neq(value: ResolveFieldType<F>): MongoFilterExpr;
  gt(value: ResolveFieldType<F>): MongoFilterExpr;
  lt(value: ResolveFieldType<F>): MongoFilterExpr;
  gte(value: ResolveFieldType<F>): MongoFilterExpr;
  lte(value: ResolveFieldType<F>): MongoFilterExpr;
  in(values: ReadonlyArray<ResolveFieldType<F>>): MongoFilterExpr;
  exists(): MongoFilterExpr;
  notExists(): MongoFilterExpr;
}
```

The filter methods are gated by codec traits — a numeric field gets `.gt()`/`.lt()`, a boolean field does not — following the same trait-gating pattern as the ORM's `MongoModelAccessor`.

### Accumulator and expression helpers

Passed into callbacks or importable directly. These produce `TypedAggExpr` with the correct output type:

**Accumulators** (for `$group`):

```typescript
interface AccumulatorHelpers {
  sum(expr: TypedAggExpr<NumericDocField>): TypedAggExpr<{ codecId: 'double'; nullable: false }>;
  sum(value: number): TypedAggExpr<{ codecId: 'double'; nullable: false }>;
  avg(expr: TypedAggExpr<NumericDocField>): TypedAggExpr<{ codecId: 'double'; nullable: true }>;
  min<F extends DocField>(expr: TypedAggExpr<F>): TypedAggExpr<F & { nullable: true }>;
  max<F extends DocField>(expr: TypedAggExpr<F>): TypedAggExpr<F & { nullable: true }>;
  first<F extends DocField>(expr: TypedAggExpr<F>): TypedAggExpr<F & { nullable: true }>;
  last<F extends DocField>(expr: TypedAggExpr<F>): TypedAggExpr<F & { nullable: true }>;
  push<F extends DocField>(expr: TypedAggExpr<F>): TypedAggExpr<ArrayDocField<F>>;
  addToSet<F extends DocField>(expr: TypedAggExpr<F>): TypedAggExpr<ArrayDocField<F>>;
  count(): TypedAggExpr<{ codecId: 'int'; nullable: false }>;
}
```

**Expression operators** (for `$project`, `$addFields`):

```typescript
interface ExpressionHelpers {
  concat(...exprs: TypedAggExpr<StringDocField>[]): TypedAggExpr<StringDocField>;
  add(...exprs: TypedAggExpr<NumericDocField>[]): TypedAggExpr<NumericDocField>;
  subtract(a: TypedAggExpr<NumericDocField>, b: TypedAggExpr<NumericDocField>): TypedAggExpr<NumericDocField>;
  multiply(...exprs: TypedAggExpr<NumericDocField>[]): TypedAggExpr<NumericDocField>;
  divide(a: TypedAggExpr<NumericDocField>, b: TypedAggExpr<NumericDocField>): TypedAggExpr<NumericDocField>;
  cond<T extends DocField, E extends DocField>(
    condition: MongoFilterExpr,
    then_: TypedAggExpr<T>,
    else_: TypedAggExpr<E>,
  ): TypedAggExpr<T | E>;
  literal<V>(value: V): TypedAggExpr<LiteralDocField<V>>;
  toLower(expr: TypedAggExpr<StringDocField>): TypedAggExpr<StringDocField>;
  toUpper(expr: TypedAggExpr<StringDocField>): TypedAggExpr<StringDocField>;
}
```

These helpers construct `MongoAggExpr` AST nodes internally (e.g., `acc.sum(expr)` constructs `new MongoAggAccumulator('$sum', expr.node)`) and wrap them in `TypedAggExpr` with the appropriate output type.

### Type-level transformations in detail

#### `$group`

The `group()` method accepts a callback that produces a `GroupSpec` — an object whose keys are the output field names:

```typescript
interface GroupSpec {
  _id: TypedAggExpr<DocField> | null | Record<string, TypedAggExpr<DocField>>;
  [key: string]: TypedAggExpr<DocField> | null | Record<string, TypedAggExpr<DocField>>;
}

type GroupedDocShape<Spec extends GroupSpec> = {
  _id: Spec['_id'] extends null
    ? { codecId: 'null'; nullable: true }
    : Spec['_id'] extends TypedAggExpr<infer F>
      ? F
      : Spec['_id'] extends Record<string, TypedAggExpr<infer F>>
        ? { codecId: 'object'; nullable: false }  // compound key
        : never;
} & {
  [K in Exclude<keyof Spec, '_id'> & string]: Spec[K] extends TypedAggExpr<infer F> ? F : never;
};
```

Example:

```typescript
pipeline.users
  .group((fields, acc) => ({
    _id: fields.city,              // TypedAggExpr<{ codecId: 'string', nullable: false }>
    count: acc.count(),            // TypedAggExpr<{ codecId: 'int', nullable: false }>
    avgAge: acc.avg(fields.age),   // TypedAggExpr<{ codecId: 'double', nullable: true }>
  }))
// Result DocShape: { _id: { codecId: 'string', nullable: false }, count: { codecId: 'int', nullable: false }, avgAge: { codecId: 'double', nullable: true } }
// Resolved row: { _id: string, count: number, avgAge: number | null }
```

#### `$project` (computed)

The callback-based `project()` overload accepts a spec where each value is either `1` (include) or a `TypedAggExpr` (computed):

```typescript
type ProjectedShape<Shape extends DocShape, Spec extends Record<string, 1 | TypedAggExpr<DocField>>> = {
  [K in keyof Spec & string]: Spec[K] extends 1
    ? K extends keyof Shape ? Shape[K] : never
    : Spec[K] extends TypedAggExpr<infer F> ? F : never;
} & ('_id' extends keyof Shape ? Pick<Shape, '_id'> : {});
```

#### `$addFields`

Each new field's type is extracted from the `TypedAggExpr`:

```typescript
type ExtractDocShape<Fields extends Record<string, TypedAggExpr<DocField>>> = {
  [K in keyof Fields & string]: Fields[K] extends TypedAggExpr<infer F> ? F : never;
};
```

The result shape is `Shape & ExtractDocShape<NewFields>`.

#### `$unwind`

Unwinding replaces an array field with its element type:

```typescript
type UnwoundShape<Shape extends DocShape, K extends keyof Shape & string> = {
  [P in keyof Shape]: P extends K ? ElementDocField<Shape[K]> : Shape[P];
};
```

### Sort specification

The sort spec is constrained to keys that exist in the current shape:

```typescript
type SortSpec<Shape extends DocShape> = Partial<Record<keyof Shape & string, 1 | -1>>;
```

### Cross-collection traversal via `$lookup`

When `$lookup` joins documents from a foreign collection, the builder introduces the foreign collection's shape as a new array field. For the basic equality form:

```typescript
interface LookupOptions<Shape extends DocShape, ForeignModel extends string, As extends string> {
  from: ForeignModel;
  localField: keyof Shape & string;
  foreignField: string;
  as: As;
}
```

The result shape gains a new field: `Shape & { [As]: ArrayDocField<ForeignDocShape> }`.

For the pipeline form, the `let`/`pipeline` version allows running a sub-pipeline against the foreign collection. The sub-pipeline independently tracks the foreign collection's shape:

```typescript
interface LookupPipelineOptions<Shape extends DocShape, ForeignModel extends string, As extends string> {
  from: ForeignModel;
  let_?: Record<string, TypedAggExpr<DocField>>;
  pipeline: (foreign: PipelineBuilder<QC, ForeignDocShape>) => PipelineBuilder<QC, DocShape>;
  as: As;
}
```

This is where **cross-collection traversal** happens in the type system — the sub-pipeline callback receives a builder scoped to the foreign collection's `DocShape`, and its transformations produce the element type for the `[as]` array field.

### Parent-to-child document traversal via `$replaceRoot`

`$replaceRoot` promotes a nested document to become the pipeline's root. This is the type-level equivalent of navigating from a parent document into an embedded child:

```typescript
pipeline.users
  .replaceRoot(fields => fields.address)
// DocShape changes from UserDocShape to AddressDocShape
```

For this to work, the `FieldProxy` needs to expose embedded document fields with their nested shape. The `TypedAggExpr` for an embedded document field carries a `DocField` whose structure includes the nested fields. The exact representation depends on how the contract models embedded documents — this intersects with value objects and embedded documents from Phase 1.75c of ORM consolidation.

### Escape hatches

Two escape hatches for stages the builder doesn't have typed methods for:

**`.pipe(stage)`** — inject any `MongoPipelineStage` directly. The document shape is preserved by default (the builder can't know what the stage does):

```typescript
pipe(stage: MongoPipelineStage): PipelineBuilder<QC, Shape>;
```

**`.pipe<NewShape>(stage)`** — inject a stage and assert the new output shape:

```typescript
pipe<NewShape extends DocShape>(stage: MongoPipelineStage): PipelineBuilder<QC, NewShape>;
```

The type assertion is the user's responsibility. This handles any stage the builder doesn't have a typed method for, including Atlas-specific stages.

## Compilation

### Builder state

The builder maintains an immutable state that's simpler than the SQL builder's `BuilderState`. An aggregation pipeline is naturally an ordered list of stages, not a composed SQL clause structure:

```typescript
interface PipelineBuilderState {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoPipelineStage>;
}
```

Each chained method clones the state and appends a stage. The callback functions construct `MongoAggExpr` AST nodes (via `TypedAggExpr` wrappers) which are assembled into the appropriate `MongoPipelineStage` node.

### `.build()` → `MongoQueryPlan`

```typescript
build(): MongoQueryPlan<ResolveRow<Shape, QC['codecTypes']>> {
  const command = new AggregateCommand(this.state.collection, this.state.stages);
  return {
    collection: this.state.collection,
    command,
    meta: {
      target: 'mongo',
      storageHash: this.context.contract.storage.storageHash,
      lane: 'mongo-pipeline',
      paramDescriptors: [],
    },
  };
}
```

The plan is a thin wrapper around `AggregateCommand` with the accumulated stages. No additional compilation step is needed — the pipeline is already a list of typed stage nodes.

### `.execute()` → `AsyncIterableResult<Row>`

```typescript
execute(): AsyncIterableResult<ResolveRow<Shape, QC['codecTypes']>> {
  const plan = this.build();
  return this.executor.execute(plan);
}
```

This flows through the existing execution path: `MongoRuntime` → adapter (`lower`) → driver → `collection.aggregate(pipeline)`.

## Pipeline-style updates (computed writes)

The aggregation expression AST serves double duty: besides powering read pipelines, it enables **computed writes** via MongoDB's pipeline-style update mechanism (MongoDB 4.2+). Traditional update operators (`$set`, `$inc`, `$push`) can only set fields to literal values. Pipeline-style updates use aggregation expressions to compute new values from existing fields.

### How it works

The pipeline builder exposes an `update()` terminal method that constructs a pipeline-style update instead of a read query. The pipeline is constrained to update-compatible stages (`$addFields`/`$set`, `$unset`, `$replaceRoot`, `$project`):

```typescript
// Compute fullName from existing firstName and lastName fields:
pipeline.users
  .match(f => f.active.eq(true))
  .computeUpdate((fields, fn) => ({
    fullName: fn.concat(fields.firstName, fn.literal(' '), fields.lastName),
    lastUpdated: fn.now(),
  }))
  .execute();
// Executes: db.users.updateMany(
//   { active: true },
//   [{ $set: { fullName: { $concat: ["$firstName", " ", "$lastName"] }, lastUpdated: "$$NOW" } }]
// )
```

```typescript
// Conditional tier upgrade based on purchase count:
pipeline.users
  .match(f => f.purchases.gte(50))
  .computeUpdate((fields, fn) => ({
    tier: fn.cond(
      fn.gte(fields.purchases, fn.literal(100)),
      fn.literal('gold'),
      fn.literal('silver'),
    ),
    discountRate: fn.cond(
      fn.gte(fields.purchases, fn.literal(100)),
      fn.literal(0.2),
      fn.literal(0.1),
    ),
  }))
  .execute();
```

### Compilation to update commands

`computeUpdate()` is a terminal method that:

1. Extracts the `.match()` filter from the pipeline stages (must be the only non-update stage)
2. Constructs `MongoAddFieldsStage` nodes from the expression callback
3. Packages them into `UpdateManyCommand` (or `FindOneAndUpdateCommand` for `.computeUpdateOne()`) with the pipeline-style update form

```typescript
computeUpdate(
  fn: (fields: FieldProxy<Shape>, helpers: ExpressionHelpers) => Record<string, TypedAggExpr<DocField>>,
): Promise<{ modifiedCount: number }>;

computeUpdateOne(
  fn: (fields: FieldProxy<Shape>, helpers: ExpressionHelpers) => Record<string, TypedAggExpr<DocField>>,
): Promise<Row | null>;
```

### Relationship to ADR 180

ADR 180's dot-path field accessor (`.set()`, `.inc()`, `.push()`) and pipeline-style updates are complementary:

| Capability | ADR 180 field accessors | Pipeline-style updates |
|------------|------------------------|----------------------|
| Set to literal value | `u("name").set("Bob")` | `fn.literal("Bob")` |
| Increment | `u("count").inc(1)` | `fn.add(fields.count, fn.literal(1))` |
| Cross-field reference | Not possible | `fields.otherField` |
| Conditional logic | Not possible | `fn.cond(...)` |
| String concatenation | Not possible | `fn.concat(...)` |

For simple mutations, ADR 180's operators are more ergonomic. For computed mutations that reference other fields or use conditional logic, pipeline-style updates are the only option. The ORM can offer both through the same collection interface.

## Relationship to the ORM

The pipeline builder and ORM are peer query surfaces at the same layer (`5-query-builders`). They're independent and share nothing at the builder level:

| Concern | ORM (`MongoCollection`) | Pipeline builder (`PipelineBuilder`) |
|---------|------------------------|--------------------------------------|
| Abstraction level | Model-centric (where, include, create) | Pipeline-centric (match, group, project) |
| Builder state | `CollectionState` (filters, includes, orderBy, selectedFields, limit, offset) | `PipelineBuilderState` (collection, stages list) |
| Compilation | `compileMongoQuery(state) → AggregateCommand` with ORM-specific stage ordering, include-to-lookup translation | Direct: stages list → `AggregateCommand` |
| Type tracking | `MongoCollection<Contract, ModelName, Includes>` — model-level row types | `PipelineBuilder<QC, DocShape>` — field-level shape transformations |
| Output type | `IncludedRow<Contract, ModelName, Includes>` | `ResolveRow<Shape, CodecTypes>` |
| Plan type | `MongoQueryPlan` | `MongoQueryPlan` (same) |
| Execution | `MongoQueryExecutor.execute(plan)` | `MongoQueryExecutor.execute(plan)` (same) |

Both produce `MongoQueryPlan` with `AggregateCommand`. Both execute through `MongoRuntime` → adapter → driver. They differ in the abstraction level presented to the user and in how they track types.

## Examples

### Group users by city, count and sort

```typescript
const pipeline = mongoPipeline({ context });

const plan = pipeline.users
  .match(f => f.age.gte(18))
  .group((fields, acc) => ({
    _id: fields.city,
    count: acc.count(),
    avgAge: acc.avg(fields.age),
  }))
  .sort({ count: -1 })
  .limit(10)
  .build();
// MongoQueryPlan<{ _id: string, count: number, avgAge: number | null }>
```

### Lookup with unwind and project

```typescript
const result = pipeline.users
  .lookup({
    from: 'posts',
    localField: '_id',
    foreignField: 'authorId',
    as: 'posts',
  })
  .unwind('posts')
  .project((fields) => ({
    userName: 1,
    postTitle: fields.posts.title,
  }))
  .execute();
// AsyncIterableResult<{ _id: ObjectId, userName: string, postTitle: string }>
```

### Add computed fields

```typescript
const result = pipeline.orders
  .addFields((fields, fn) => ({
    totalPrice: fn.multiply(fields.price, fields.quantity),
    hasDiscount: fn.literal(false),
  }))
  .match(f => f.totalPrice.gte(100))
  .execute();
// AsyncIterableResult<{ ..., totalPrice: number, hasDiscount: boolean }>
```

### Replace root — navigate into embedded document

```typescript
const result = pipeline.users
  .match(f => f.status.eq('active'))
  .replaceRoot(fields => fields.address)
  .project('city', 'zipCode')
  .execute();
// AsyncIterableResult<{ _id: ObjectId, city: string, zipCode: string }>
```

### Faceted search — multiple aggregations in one pass

```typescript
const result = pipeline.products
  .match(f => f.category.eq('electronics'))
  .facet({
    priceRanges: (b) => b
      .group((fields, acc) => ({
        _id: fn.cond(
          fn.lt(fields.price, fn.literal(100)),
          fn.literal('budget'),
          fn.cond(fn.lt(fields.price, fn.literal(500)), fn.literal('mid'), fn.literal('premium')),
        ),
        count: acc.count(),
      }))
      .sort({ count: -1 }),

    topBrands: (b) => b
      .group((fields, acc) => ({
        _id: fields.brand,
        avgRating: acc.avg(fields.rating),
        count: acc.count(),
      }))
      .sort({ avgRating: -1 })
      .limit(5),

    recentlyAdded: (b) => b
      .sort({ createdAt: -1 })
      .limit(10)
      .project('name', 'price', 'createdAt'),
  })
  .execute();
// AsyncIterableResult<{
//   priceRanges: Array<{ _id: string, count: number }>,
//   topBrands: Array<{ _id: string, avgRating: number | null, count: number }>,
//   recentlyAdded: Array<{ _id: ObjectId, name: string, price: number, createdAt: Date }>,
// }>
```

### Correlated lookup — recent orders per user

```typescript
const result = pipeline.users
  .match(f => f.status.eq('active'))
  .lookup({
    from: 'orders',
    let_: { userId: (fields) => fields._id },
    pipeline: (orders) => orders
      .match(f => f.expr(fn.eq(fn.fieldRef('customerId'), fn.variable('userId'))))
      .sort({ createdAt: -1 })
      .limit(3)
      .project('total', 'createdAt', 'status'),
    as: 'recentOrders',
  })
  .project((fields) => ({
    name: 1,
    email: 1,
    recentOrders: 1,
    orderCount: fn.size(fields.recentOrders),
  }))
  .execute();
// AsyncIterableResult<{
//   _id: ObjectId,
//   name: string,
//   email: string,
//   recentOrders: Array<{ _id: ObjectId, total: number, createdAt: Date, status: string }>,
//   orderCount: number,
// }>
```

### Computed update — bulk tier upgrade

```typescript
pipeline.users
  .match(f => f.tier.eq('silver'))
  .computeUpdate((fields, fn) => ({
    tier: fn.cond(
      fn.gte(fields.totalPurchases, fn.literal(1000)),
      fn.literal('gold'),
      fields.tier,
    ),
    lastTierReview: fn.now(),
    tierHistory: fn.concatArrays(
      fields.tierHistory,
      [fn.literal({ from: 'silver', reviewedAt: '$$NOW' })],
    ),
  }))
  .execute();
// Updates all silver-tier users: promotes to gold if totalPurchases >= 1000,
// records the review timestamp, and appends to tier history.
```

### Window function — running totals

```typescript
const result = pipeline.transactions
  .match(f => f.accountId.eq(accountId))
  .sort({ date: 1 })
  .setWindowFields({
    sortBy: { date: 1 },
    output: {
      runningBalance: { expr: acc.sum(fields.amount), window: { documents: ['unbounded', 'current'] } },
      movingAvg7d: { expr: acc.avg(fields.amount), window: { range: [-7, 'current'], unit: 'day' } },
    },
  })
  .execute();
// AsyncIterableResult<{ ..., runningBalance: number, movingAvg7d: number | null }>
```

## Open questions

1. **Nested field access in `FieldProxy`** — For embedded documents, should the proxy use chained property access (`fields.address.city`) or a dot-path helper (`fields("address.city")`)? Chained access is more ergonomic and matches the SQL builder's `FieldProxy`, but requires `Proxy` with recursive type definitions. Dot-path is simpler to implement. The SQL builder uses chained access.

2. **Compound `$group._id` type inference** — When `_id` is a compound key (`{ city: fields.city, year: fields.year }`), the result `_id` field should be `{ city: string, year: number }`. This requires the type system to resolve each sub-expression's type and compose them into an object. Feasible but adds type-level complexity.

3. **`$facet` sub-pipeline typing** — Each facet runs an independent sub-pipeline. The `facet()` method needs each callback to independently track its output shape, and the result shape is `{ [facetName]: SubPipelineRow[] }`. This is the most complex type-level transformation and may benefit from a separate design pass.

4. **`$lookup` pipeline form** — The `let`/`pipeline` form of `$lookup` requires the sub-pipeline to run in the foreign collection's scope, with `$$` variables bound from the current document. Expressing this in the type system means the sub-pipeline's `FieldProxy` needs to include both the foreign collection's fields and the let bindings. Complex but important for real-world queries.

5. **Expression helper coverage** — How many expression helpers (arithmetic, string, date, etc.) should exist at launch? The `MongoAggOperator` with `op: string` can represent any operator at the AST level, but typed builder helpers provide autocomplete and type safety. Start with the most common operators (arithmetic, `$concat`, `$cond`, `$literal`, `$toUpper`/`$toLower`) and expand based on usage.

6. **`$setWindowFields` type inference** — Window functions add computed fields partitioned over groups. The type transformation is similar to `$addFields` but the accumulator context is windowed. This is complex and may be deferred to a later iteration.

7. **Accumulator output type precision** — `$sum` on integer fields returns integer, on double returns double, on mixed returns double. For the type system, mapping accumulator + input codec → output codec precisely requires a type-level lookup table. The pragmatic default: all numeric accumulators produce `'double'`.

## References

- [Aggregation expression AST design](./aggregation-expression-ast-design.md)
- [Pipeline AST completeness design](./pipeline-ast-completeness-design.md)
- [Milestone 1 pipeline AST design](./milestone-1-pipeline-ast-design.md)
- [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [ADR 175 — Shared ORM Collection interface](../../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)
- [SQL query builder](../../../packages/2-sql/4-lanes/sql-builder/) — precedent for fluent API, immutable state, `ScopeField`/`ResolveRow`
- [Linear: TML-2207](https://linear.app/prisma-company/issue/TML-2207)
