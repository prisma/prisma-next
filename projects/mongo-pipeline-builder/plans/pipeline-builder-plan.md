# Pipeline Builder with Shape Tracking — Task Plan

Detailed design and execution plan for [TML-2211](https://linear.app/prisma-company/issue/TML-2211).

**Spec:** [projects/mongo-pipeline-builder/spec.md](../spec.md)

**Precedent:** The SQL query builder (`@prisma-next/sql-builder`) — fluent API, immutable `BuilderState`, `ScopeField`/`ResolveRow` pattern, `FieldProxy` via `Proxy`.

## Overview

The pipeline builder is a **static, type-safe plan constructor** for MongoDB aggregation pipelines. It tracks document shape transformations at the type level and produces `MongoQueryPlan` — it never executes queries.

The builder composes existing AST primitives from `@prisma-next/mongo-query-ast` (stage classes, `MongoAggExpr`, `MongoFilterExpr`) with new type-level machinery (`DocField`, `DocShape`, `TypedAggExpr<F>`) that makes field references, expressions, and stage outputs type-safe.

## Package structure

### Prerequisite: restructure `5-query-builders/`

Currently `packages/2-mongo-family/5-query-builders/` is a single package (`@prisma-next/mongo-orm`). Restructure to host multiple packages:

```
packages/2-mongo-family/5-query-builders/
  orm/                          ← @prisma-next/mongo-orm (moved from parent)
    package.json
    src/
    test/
  pipeline-builder/             ← @prisma-next/mongo-pipeline-builder (new)
    package.json
    src/
    test/
```

Update `architecture.config.json` to split the existing glob:

```json
{
  "glob": "packages/2-mongo-family/5-query-builders/orm/**",
  "domain": "mongo",
  "layer": "query-builders",
  "plane": "runtime"
},
{
  "glob": "packages/2-mongo-family/5-query-builders/pipeline-builder/**",
  "domain": "mongo",
  "layer": "query-builders",
  "plane": "runtime"
}
```

Also update `pnpm-workspace.yaml` if it uses explicit package paths rather than globs.

### New package dependencies

```
@prisma-next/mongo-pipeline-builder
  ├── @prisma-next/contract          (PlanMeta)
  ├── @prisma-next/mongo-contract    (MongoContract, MongoContractWithTypeMaps, ExtractMongoCodecTypes)
  └── @prisma-next/mongo-query-ast   (stage classes, AggregateCommand, MongoQueryPlan, MongoAggExpr, MongoFilterExpr)
```

No dependency on `@prisma-next/runtime-executor`, `@prisma-next/mongo-orm`, or any target/adapter package.

## Type machinery

### `DocField`

The atomic unit of shape tracking. Each field carries its codec identity and nullability — the same two properties as `ContractModel['fields'][K]`:

```typescript
interface DocField {
  readonly codecId: string;
  readonly nullable: boolean;
}
```

### `DocShape`

A record of named fields representing the current document shape at a point in the pipeline:

```typescript
type DocShape = Record<string, DocField>;
```

### `ModelToDocShape`

Derives the initial `DocShape` from a contract model's field definitions:

```typescript
type ModelToDocShape<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['fields'] & string]: {
    readonly codecId: TContract['models'][ModelName]['fields'][K]['codecId'];
    readonly nullable: TContract['models'][ModelName]['fields'][K]['nullable'];
  };
};
```

This is structurally the identity mapping — contract fields already have `{ codecId, nullable }`. The explicit mapped type ensures the builder's type parameter is `DocShape`-shaped regardless of contract-specific quirks.

### `ResolveRow`

Resolves a `DocShape` into concrete TypeScript types using the contract's codec type maps. Structurally identical to `InferModelRow` in `@prisma-next/mongo-contract`, but generalized to work on arbitrary shapes rather than a specific model's fields:

```typescript
type ResolveRow<
  Shape extends DocShape,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = {
  -readonly [K in keyof Shape & string]: Shape[K]['nullable'] extends true
    ? CodecTypes[Shape[K]['codecId']]['output'] | null
    : CodecTypes[Shape[K]['codecId']]['output'];
};
```

### `TypedAggExpr<F>`

Wraps a contract-agnostic `MongoAggExpr` AST node with a phantom type parameter that carries the expression's output type through the builder's type system:

```typescript
interface TypedAggExpr<F extends DocField> {
  readonly _field: F;    // phantom — never read at runtime
  readonly node: MongoAggExpr;
}
```

Builder-level helpers (`fn.concat()`, `acc.sum()`, field proxy properties) return `TypedAggExpr<F>` with the correct `F` inferred from the expression semantics:

- `f.amount` (field ref where amount has `codecId: 'mongo/double@1'`) → `TypedAggExpr<{ codecId: 'mongo/double@1', nullable: false }>`
- `acc.sum(expr)` → `TypedAggExpr<{ codecId: 'double', nullable: false }>` (all numeric accumulators default to `'double'`)
- `fn.concat(a, b)` → `TypedAggExpr<{ codecId: 'mongo/string@1', nullable: false }>`
- `acc.count()` → `TypedAggExpr<{ codecId: 'double', nullable: false }>`

### `ExtractDocShape`

Extracts a `DocShape` from a record of `TypedAggExpr` values (used by `addFields`, `group`, computed `project`):

```typescript
type ExtractDocShape<T extends Record<string, TypedAggExpr<DocField>>> = {
  [K in keyof T & string]: T[K]['_field'];
};
```

## Builder class

### State

```typescript
interface PipelineBuilderState {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoReadStage>;
  readonly storageHash: string;
}
```

### Class shape

```typescript
class PipelineBuilder<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  Shape extends DocShape,
> {
  readonly #contract: TContract;
  readonly #state: PipelineBuilderState;

  // Immutable chaining: each method returns a new PipelineBuilder
  #withStage<NewShape extends DocShape>(
    stage: MongoReadStage,
  ): PipelineBuilder<TContract, NewShape>;
}
```

Every stage method calls `#withStage()` which clones the state with the new stage appended. The `NewShape` type parameter is the key mechanism — it varies per stage category.

### `build()`

```typescript
build(): MongoQueryPlan<ResolveRow<Shape, ExtractMongoCodecTypes<TContract>>> {
  const command = new AggregateCommand(this.#state.collection, this.#state.stages);
  const meta: PlanMeta = {
    target: 'mongo',
    storageHash: this.#state.storageHash,
    lane: 'mongo-pipeline',
    paramDescriptors: [],
  };
  return { collection: this.#state.collection, command, meta };
}
```

## Stage methods

### Identity stages — `Shape` unchanged

```typescript
match(filter: MongoFilterExpr): PipelineBuilder<TContract, Shape>;
match(fn: (fields: FilterProxy<Shape>) => MongoFilterExpr): PipelineBuilder<TContract, Shape>;

sort(spec: SortSpec<Shape>): PipelineBuilder<TContract, Shape>;
limit(n: number): PipelineBuilder<TContract, Shape>;
skip(n: number): PipelineBuilder<TContract, Shape>;
sample(n: number): PipelineBuilder<TContract, Shape>;
```

`SortSpec<Shape>` constrains keys to the current shape:

```typescript
type SortSpec<S extends DocShape> = Partial<Record<keyof S & string, 1 | -1>>;
```

### Additive stages — `Shape` gains fields

**`addFields`:**

```typescript
addFields<NewFields extends Record<string, TypedAggExpr<DocField>>>(
  fn: (fields: FieldProxy<Shape>) => NewFields,
): PipelineBuilder<TContract, Shape & ExtractDocShape<NewFields>>;
```

The callback receives a `FieldProxy<Shape>` and returns a record of named `TypedAggExpr` values. The resulting shape is the intersection of the existing shape and the new fields.

At runtime, the `MongoAggExpr` nodes are extracted from each `TypedAggExpr` to construct a `MongoAddFieldsStage`.

**`lookup` (equality form):**

```typescript
lookup<
  ForeignRoot extends keyof TContract['roots'] & string,
  As extends string,
>(options: {
  from: ForeignRoot;
  localField: keyof Shape & string;
  foreignField: string;
  as: As;
}): PipelineBuilder<TContract, Shape & Record<As, ArrayDocField<ForeignRoot>>>;
```

Where `ArrayDocField<ForeignRoot>` is a `DocField` with a codec representing an array of the foreign model's shape. The exact codec representation for array fields is TBD — may use a synthetic codec like `'array<model>'` or carry the nested shape inline.

### Narrowing stages — `Shape` loses/transforms fields

**`project` (inclusion form):**

```typescript
project<K extends keyof Shape & string>(
  ...keys: K[]
): PipelineBuilder<TContract, Pick<Shape, K | '_id'>>;
```

Only named fields survive. `_id` is included by default (MongoDB behavior), unless explicitly excluded.

**`project` (computed form):**

```typescript
project<Spec extends Record<string, 1 | TypedAggExpr<DocField>>>(
  fn: (fields: FieldProxy<Shape>) => Spec,
): PipelineBuilder<TContract, ProjectedShape<Shape, Spec>>;
```

Where `ProjectedShape` picks included fields (value `1`) and adds computed fields (value `TypedAggExpr<F>`) with their inferred types.

**`unwind`:**

```typescript
unwind<K extends keyof Shape & string>(
  field: K,
  options?: { preserveNullAndEmptyArrays?: boolean },
): PipelineBuilder<TContract, UnwoundShape<Shape, K>>;
```

`UnwoundShape<Shape, K>` replaces the array field's type with its element type:

```typescript
type UnwoundShape<S extends DocShape, K extends keyof S & string> = {
  [P in keyof S]: P extends K ? UnwrapArrayDocField<S[P]> : S[P];
};
```

### Replacement stages — `Shape` is entirely new

**`group`:**

```typescript
group<Spec extends GroupSpec>(
  fn: (fields: FieldProxy<Shape>) => Spec,
): PipelineBuilder<TContract, GroupedDocShape<Spec>>;
```

The callback receives a proxy of the current shape (for building `_id` and accumulator expressions) and returns a group specification with `_id` plus named accumulators. The resulting shape contains only the fields declared in the spec — the previous shape is completely discarded.

```typescript
type GroupSpec = {
  _id: TypedAggExpr<DocField> | null;
  [key: string]: TypedAggExpr<DocField> | null;
};

type GroupedDocShape<Spec extends GroupSpec> = {
  [K in keyof Spec & string]: Spec[K] extends TypedAggExpr<infer F> ? F : DocField;
};
```

**`replaceRoot`:**

```typescript
replaceRoot<NewShape extends DocShape>(
  fn: (fields: FieldProxy<Shape>) => TypedAggExpr</* embedded shape */>,
): PipelineBuilder<TContract, NewShape>;
```

Replaces the entire shape. The new shape must be explicitly provided or inferred from the expression.

**`count`:**

```typescript
count<Field extends string>(
  field: Field,
): PipelineBuilder<TContract, Record<Field, { codecId: 'double'; nullable: false }>>;
```

**`sortByCount`:**

```typescript
sortByCount(
  fn: (fields: FieldProxy<Shape>) => TypedAggExpr<DocField>,
): PipelineBuilder<TContract, { _id: DocField; count: { codecId: 'double'; nullable: false } }>;
```

### Escape hatch

```typescript
// Shape-preserving: trust that the stage doesn't change the shape
pipe(stage: MongoReadStage): PipelineBuilder<TContract, Shape>;

// Shape-asserting: user declares the new shape
pipe<NewShape extends DocShape>(stage: MongoReadStage): PipelineBuilder<TContract, NewShape>;
```

## Proxies

### `FieldProxy<Shape>`

A mapped type at the type level, a `Proxy` at runtime. Each property corresponding to a field in `Shape` returns a `TypedAggExpr<Shape[K]>`:

```typescript
type FieldProxy<S extends DocShape> = {
  readonly [K in keyof S & string]: TypedAggExpr<S[K]>;
};
```

At runtime, the `Proxy` intercepts property access and returns a `TypedAggExpr` wrapping a `MongoAggFieldRef`:

```typescript
function createFieldProxy<S extends DocShape>(): FieldProxy<S> {
  return new Proxy({} as FieldProxy<S>, {
    get(_target, prop: string) {
      return { _field: undefined, node: MongoAggFieldRef.of(prop) };
    },
  });
}
```

The `_field` property is phantom — it's only used by the type system, never read at runtime.

### `FilterProxy<Shape>`

Each property corresponding to a field in `Shape` returns a filter handle with comparison methods:

```typescript
type FilterProxy<S extends DocShape> = {
  readonly [K in keyof S & string]: FilterHandle;
};

interface FilterHandle {
  eq(value: unknown): MongoFilterExpr;
  ne(value: unknown): MongoFilterExpr;
  gt(value: unknown): MongoFilterExpr;
  gte(value: unknown): MongoFilterExpr;
  lt(value: unknown): MongoFilterExpr;
  lte(value: unknown): MongoFilterExpr;
  in(values: ReadonlyArray<unknown>): MongoFilterExpr;
  exists(flag?: boolean): MongoFilterExpr;
}
```

At runtime, each method constructs the corresponding `MongoFieldFilter` AST node.

## Expression and accumulator helpers

### `ExpressionHelpers` (exported as `fn`)

Starter set for TML-2211. Each helper returns `TypedAggExpr<F>` wrapping the corresponding `MongoAggOperator`:

| Helper | MongoDB operator | Output codecId |
|---|---|---|
| `fn.add(a, b, ...)` | `$add` | `'double'` |
| `fn.subtract(a, b)` | `$subtract` | `'double'` |
| `fn.multiply(a, b, ...)` | `$multiply` | `'double'` |
| `fn.divide(a, b)` | `$divide` | `'double'` |
| `fn.concat(a, b, ...)` | `$concat` | `'mongo/string@1'` |
| `fn.toLower(a)` | `$toLower` | `'mongo/string@1'` |
| `fn.toUpper(a)` | `$toUpper` | `'mongo/string@1'` |
| `fn.size(a)` | `$size` | `'double'` |
| `fn.cond(if, then, else)` | `$cond` | inferred from `then` |
| `fn.literal(value)` | `$literal` | user-specified `F` |

Full operator coverage is tracked in [TML-2217](https://linear.app/prisma-company/issue/TML-2217).

### `AccumulatorHelpers` (exported as `acc`)

| Helper | MongoDB operator | Output codecId | Nullable |
|---|---|---|---|
| `acc.sum(expr)` | `$sum` | `'double'` | false |
| `acc.avg(expr)` | `$avg` | `'double'` | true |
| `acc.min(expr)` | `$min` | same as input | true |
| `acc.max(expr)` | `$max` | same as input | true |
| `acc.first(expr)` | `$first` | same as input | true |
| `acc.last(expr)` | `$last` | same as input | true |
| `acc.push(expr)` | `$push` | array of input | false |
| `acc.addToSet(expr)` | `$addToSet` | array of input | false |
| `acc.count()` | `$count` (null arg) | `'double'` | false |

Numeric accumulators default to `'double'` output type. Precision refinement (e.g. `$sum` on an int field returns int) is deferred to TML-2217.

## Entry point

```typescript
export function mongoPipeline<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: {
  contractJson: unknown;
}): PipelineRoot<TContract>;

interface PipelineRoot<TContract extends MongoContractWithTypeMaps> {
  from<K extends keyof TContract['roots'] & string>(
    rootName: K,
  ): PipelineBuilder<
    TContract,
    ModelToDocShape<TContract, TContract['roots'][K] & string & keyof TContract['models']>
  >;
}
```

At runtime, `mongoPipeline()` validates the contract JSON (collection name resolution) and returns a `PipelineRoot` whose `from()` method creates a `PipelineBuilder` with the initial shape derived from the contract model. The `TContract` type parameter carries full type information via the type parameter pattern (same as `validateContract<Contract>(contractJson)`).

## Task breakdown

### 4.0 — Restructure `5-query-builders/`

Move `@prisma-next/mongo-orm` from `packages/2-mongo-family/5-query-builders/` to `packages/2-mongo-family/5-query-builders/orm/`.

- Move all files (src, test, package.json, tsconfig, etc.)
- Update `pnpm-workspace.yaml` if needed
- Update `architecture.config.json` glob
- Run `pnpm install` to update lockfile
- Verify `pnpm build` and `pnpm test:packages` pass
- Verify `pnpm lint:deps` passes

No new code. Purely structural. This should be its own commit.

### 4.1 — Scaffold pipeline-builder package

Create `packages/2-mongo-family/5-query-builders/pipeline-builder/`:

- `package.json` with name `@prisma-next/mongo-pipeline-builder`, dependencies on `contract`, `mongo-contract`, `mongo-query-ast`
- `tsconfig.json` and `tsconfig.prod.json`
- `tsdown.config.ts`
- `vitest.config.ts`
- `biome.jsonc`
- `src/exports/index.ts` (empty initially)
- Architecture config entry for the new glob

### 4.2 — Core type machinery

Files: `src/types.ts`

Implement and type-test:
- `DocField`
- `DocShape`
- `ModelToDocShape<TContract, ModelName>`
- `ResolveRow<Shape, CodecTypes>`
- `TypedAggExpr<F>`
- `ExtractDocShape<T>`

Type tests (`test/types.test-d.ts`):
- Contract model fields → `DocShape` derivation is correct
- `DocShape` → `ResolveRow` produces expected concrete types
- Nullable fields gain `| null`
- Unknown codec falls back to `unknown`

### 4.3 — Builder skeleton + identity stages

Files: `src/builder.ts`, `src/state.ts`

- `PipelineBuilderState` interface
- `PipelineBuilder` class with `#contract`, `#state`, `#withStage()`
- `match(filter)` (filter-expression overload only — proxy overload in 4.4)
- `sort(spec)`, `limit(n)`, `skip(n)`, `sample(n)`
- `build()` → `MongoQueryPlan`
- Entry point `mongoPipeline()` and `PipelineRoot.from()`

Type tests:
- Shape is unchanged after identity stages
- `build()` return type resolves correctly
- `sort()` only accepts keys from current shape

Unit tests:
- `build()` produces correct `AggregateCommand` with expected stages
- `PlanMeta` has `lane: 'mongo-pipeline'`

### 4.4 — FieldProxy, FilterProxy, match callback

Files: `src/field-proxy.ts`, `src/filter-proxy.ts`

- `createFieldProxy<Shape>()` — `Proxy`-based
- `createFilterProxy<Shape>()` — `Proxy`-based, each property returns `FilterHandle`
- `FilterHandle` with `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`
- `match()` callback overload on `PipelineBuilder`
- `SortSpec<Shape>` type

Type tests:
- Proxy properties match shape keys
- Unknown field access is a compile error

Unit tests:
- Filter proxy methods produce correct `MongoFieldFilter` nodes
- `match()` callback composes correctly

### 4.5 — TypedAggExpr, ExpressionHelpers, addFields

Files: `src/expression-helpers.ts`, update `src/builder.ts`

- `TypedAggExpr<F>` interface (if not already in types.ts)
- `fn` namespace with starter helpers (see table above)
- `addFields()` method on `PipelineBuilder`

Type tests:
- `fn.concat(a, b)` returns `TypedAggExpr<{ codecId: 'mongo/string@1', nullable: false }>`
- After `addFields`, new fields accessible, existing fields preserved
- `fn.cond` infers output type from `then` branch

Unit tests:
- `addFields()` produces `MongoAddFieldsStage` with correct expressions
- Expression helpers wrap correct `MongoAggOperator` nodes

### 4.6 — project

Update `src/builder.ts`

- Inclusion overload: `project('field1', 'field2')` → `Pick<Shape, K | '_id'>`
- Computed overload: callback returning `Record<string, 1 | TypedAggExpr>`

Type tests:
- Excluded fields inaccessible after inclusion project
- Computed fields have correct types
- `_id` included by default

Unit tests:
- Produces correct `MongoProjectStage`

### 4.7 — AccumulatorHelpers, group

Files: `src/accumulator-helpers.ts`, update `src/builder.ts`

- `acc` namespace with helpers (see table above)
- `group()` method on `PipelineBuilder`
- `GroupSpec`, `GroupedDocShape` types

Type tests:
- Previous shape completely replaced after `group()`
- Accumulator output types correct (`sum` → double, `avg` → nullable double)
- `_id: null` produces `_id: null` field

Unit tests:
- Produces correct `MongoGroupStage` with `MongoAggAccumulator` nodes

### 4.8 — unwind

Update `src/builder.ts`, add `UnwoundShape` to `src/types.ts`

Type tests:
- Array field → element type
- Non-array fields unchanged
- `includeArrayIndex` option

Unit tests:
- Produces correct `MongoUnwindStage`

### 4.9 — lookup, replaceRoot, count, sortByCount

Update `src/builder.ts`

- `lookup()` — equality form, adds array field
- `replaceRoot()` — replaces entire shape
- `count(field)` — replacement to single-field shape
- `sortByCount()` — replacement to `{ _id, count }` shape

Type tests for each stage's shape transformation.

Unit tests: each produces the correct AST stage class.

### 4.10 — pipe escape hatch, finalize entry point

Update `src/builder.ts`

- `pipe(stage)` — shape-preserving overload
- `pipe<NewShape>(stage)` — shape-asserting overload
- Finalize `mongoPipeline()` factory (contract validation, collection resolution)

Type tests:
- Shape-preserving `pipe` keeps current shape
- Shape-asserting `pipe` replaces shape

### 4.11 — Integration tests

Files: `test/integration/test/mongo/pipeline-builder.test.ts` (or similar)

Four scenarios against mongodb-memory-server:
1. `match → group → sort → limit` — analytics query
2. `addFields → match` — filter on computed field
3. `lookup → unwind → project` — cross-collection join
4. `replaceRoot` — embedded document extraction

Each test:
- Seeds data
- Builds a plan via the pipeline builder
- Executes the plan via `MongoRuntime`
- Asserts correct results with correct types

### 4.12 — Export wiring

- Finalize `src/exports/index.ts`
- Export: `mongoPipeline`, `PipelineBuilder` (type), `PipelineRoot` (type), `fn`, `acc`, `DocField`, `DocShape`, `TypedAggExpr`, `ResolveRow`
- Run `pnpm lint:deps` to verify layering
- Run `pnpm build` to verify dist output

## Test strategy

| Layer | What | Where |
|---|---|---|
| Type tests | Shape tracking across all stage categories | `test/*.test-d.ts` |
| Unit tests | Each stage method produces correct AST nodes, proxies construct correct filter/expression nodes | `test/*.test.ts` |
| Integration tests | Multi-stage pipelines execute against mongodb-memory-server with correct results | `test/integration/test/mongo/` |
