# Milestone 1: Mongo Query AST — Design

Implementation design for the typed query AST in `@prisma-next/mongo-query-ast`. This document describes the type hierarchies, interfaces, and patterns. For execution order and task breakdown, see [phase-1-mongo-collection-spike.md](./phase-1-mongo-collection-spike.md).

**Precedent:** The SQL AST in [`relational-core/src/ast/types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — class hierarchy, visitor/rewriter/folder interfaces, immutable frozen instances, hidden abstract bases with exported discriminated unions.

## Design principles

1. **Mirror the SQL AST pattern.** Classes with `kind` discriminant, abstract bases hidden from export, concrete classes exposed via discriminated unions. `accept()` for visitors, `rewrite()` for transformations.
2. **Contract-agnostic.** The AST deals in MongoDB concepts (fields, operators, pipeline stages), not contract concepts (models, codecIds, relations). The ORM bridges the gap.
3. **Lowering in the AST package.** The AST is structurally close to the MongoDB driver's document format. Lowering is a thin, mechanical translation from typed nodes to plain documents. The functions live in `mongo-query-ast` (not the adapter) because cross-domain import rules prevent `mongo-runtime` (mongo domain) from importing the adapter (targets domain). The shared `resolveValue` utility lives in `mongo-core` to eliminate duplication between AST lowering and command lowering in the adapter.
4. **Extensible operators via traits.** Filter operators are strings, not a closed enum. The ORM gates which operators appear on `MongoModelAccessor` fields using codec traits — the same pattern as SQL's `COMPARISON_METHODS_META` + `CodecTrait`.
5. **Raw escape hatch goes through the runtime.** Both typed AST and raw aggregation plans flow through `MongoRuntime.execute()` — the same runtime middleware. The raw escape hatch bypasses the typed AST, not the runtime.
6. **Prove extensibility with a pass-through operator.** Milestone 1 includes adding one extension operator (e.g., a vector `$near` operator on a vector codec) to validate the trait-gated extensibility pattern end-to-end.

## Class hierarchy

```
MongoAstNode (abstract, hidden)
├── readonly kind: string
├── protected freeze(): void
│
├── MongoFilterExpression (abstract, hidden)
│   ├── abstract accept<R>(visitor: MongoFilterVisitor<R>): R
│   ├── abstract rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr
│   │
│   ├── MongoFieldFilter          kind: 'field'
│   ├── MongoAndExpr              kind: 'and'
│   ├── MongoOrExpr               kind: 'or'
│   ├── MongoNotExpr              kind: 'not'
│   └── MongoExistsExpr           kind: 'exists'
│
└── MongoStageNode (abstract, hidden)
    ├── abstract accept<R>(visitor: MongoStageVisitor<R>): R
    ├── abstract rewrite(rewriter: MongoFilterRewriter): MongoReadStage
    │
    ├── MongoMatchStage           kind: 'match'
    ├── MongoProjectStage         kind: 'project'
    ├── MongoSortStage            kind: 'sort'
    ├── MongoLimitStage           kind: 'limit'
    ├── MongoSkipStage            kind: 'skip'
    ├── MongoLookupStage          kind: 'lookup'
    └── MongoUnwindStage          kind: 'unwind'
```

Abstract bases (`MongoAstNode`, `MongoFilterExpression`, `MongoStageNode`) are **not exported**. The public API is the discriminated unions `MongoFilterExpr` and `MongoReadStage`, plus the concrete classes and visitor interfaces.

This matches SQL where `AstNode`, `Expression`, `FromSource`, and `QueryAst` are module-private; consumers use `AnyExpression`, `AnyQueryAst`, etc.

## Filter expression AST

### Base class

```typescript
abstract class MongoAstNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }
}

abstract class MongoFilterExpression extends MongoAstNode {
  abstract accept<R>(visitor: MongoFilterVisitor<R>): R;
  abstract rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr;

  not(): MongoNotExpr {
    return new MongoNotExpr(this as unknown as MongoFilterExpr);
  }
}
```

### Concrete classes

#### `MongoFieldFilter`

A comparison on a single field: `field op value`.

```typescript
export class MongoFieldFilter extends MongoFilterExpression {
  readonly kind = 'field' as const;
  readonly field: string;
  readonly op: string;
  readonly value: MongoValue;

  constructor(field: string, op: string, value: MongoValue) {
    super();
    this.field = field;
    this.op = op;
    this.value = value;
    this.freeze();
  }

  static of(field: string, op: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, op, value);
  }

  static eq(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$eq', value);
  }

  static neq(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$ne', value);
  }

  static gt(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$gt', value);
  }

  static lt(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$lt', value);
  }

  static gte(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$gte', value);
  }

  static lte(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$lte', value);
  }

  static in(field: string, values: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$in', values);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.field(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    return rewriter.field ? rewriter.field(this) : this;
  }
}
```

The `op` field is a `string`, not a closed union. The ORM's `MongoModelAccessor` controls which operators are surfaced per field based on codec traits. The AST itself imposes no restriction — any MongoDB comparison operator (`$eq`, `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`, `$nin`, `$regex`, `$elemMatch`, etc.) can be represented. Extension packs add new operators by registering them with their required traits.

This mirrors how SQL's `BinaryOp` is a union of known operators, but `OperationExpr` can represent arbitrary target-specific functions via `SqlLoweringSpec`. The difference is that MongoDB operators are syntactically uniform (field → operator → value), so a single `MongoFieldFilter` class suffices where SQL needs both `BinaryExpr` and `OperationExpr`.

#### `MongoAndExpr`

```typescript
export class MongoAndExpr extends MongoFilterExpression {
  readonly kind = 'and' as const;
  readonly exprs: ReadonlyArray<MongoFilterExpr>;

  constructor(exprs: ReadonlyArray<MongoFilterExpr>) {
    super();
    this.exprs = Object.freeze([...exprs]);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<MongoFilterExpr>): MongoAndExpr {
    return new MongoAndExpr(exprs);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.and(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    const rewritten = new MongoAndExpr(this.exprs.map((e) => e.rewrite(rewriter)));
    return rewriter.and ? rewriter.and(rewritten) : rewritten;
  }
}
```

#### `MongoOrExpr`

```typescript
export class MongoOrExpr extends MongoFilterExpression {
  readonly kind = 'or' as const;
  readonly exprs: ReadonlyArray<MongoFilterExpr>;

  constructor(exprs: ReadonlyArray<MongoFilterExpr>) {
    super();
    this.exprs = Object.freeze([...exprs]);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<MongoFilterExpr>): MongoOrExpr {
    return new MongoOrExpr(exprs);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.or(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    const rewritten = new MongoOrExpr(this.exprs.map((e) => e.rewrite(rewriter)));
    return rewriter.or ? rewriter.or(rewritten) : rewritten;
  }
}
```

#### `MongoNotExpr`

```typescript
export class MongoNotExpr extends MongoFilterExpression {
  readonly kind = 'not' as const;
  readonly expr: MongoFilterExpr;

  constructor(expr: MongoFilterExpr) {
    super();
    this.expr = expr;
    this.freeze();
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.not(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    const rewritten = new MongoNotExpr(this.expr.rewrite(rewriter));
    return rewriter.not ? rewriter.not(rewritten) : rewritten;
  }
}
```

#### `MongoExistsExpr`

Tests for field existence via `{ field: { $exists: true/false } }`.

```typescript
export class MongoExistsExpr extends MongoFilterExpression {
  readonly kind = 'exists' as const;
  readonly field: string;
  readonly exists: boolean;

  constructor(field: string, exists: boolean) {
    super();
    this.field = field;
    this.exists = exists;
    this.freeze();
  }

  static exists(field: string): MongoExistsExpr {
    return new MongoExistsExpr(field, true);
  }

  static notExists(field: string): MongoExistsExpr {
    return new MongoExistsExpr(field, false);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.exists(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    return rewriter.exists ? rewriter.exists(this) : this;
  }
}
```

### Exported union

```typescript
export type MongoFilterExpr =
  | MongoFieldFilter
  | MongoAndExpr
  | MongoOrExpr
  | MongoNotExpr
  | MongoExistsExpr;
```

## Read stage AST

### Base class

```typescript
abstract class MongoStageNode extends MongoAstNode {
  abstract accept<R>(visitor: MongoStageVisitor<R>): R;
  abstract rewrite(rewriter: MongoFilterRewriter): MongoReadStage;
}
```

Stage `rewrite()` accepts a `MongoFilterRewriter` and recurses into any embedded filter expressions. Leaf stages (limit, skip, sort, project) return `this`. Stages containing filters or nested pipelines rebuild themselves with rewritten children.

### Concrete classes

#### `MongoMatchStage`

```typescript
export class MongoMatchStage extends MongoStageNode {
  readonly kind = 'match' as const;
  readonly filter: MongoFilterExpr;

  constructor(filter: MongoFilterExpr) {
    super();
    this.filter = filter;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.match(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoReadStage {
    return new MongoMatchStage(this.filter.rewrite(rewriter));
  }
}
```

#### `MongoProjectStage`

```typescript
export class MongoProjectStage extends MongoStageNode {
  readonly kind = 'project' as const;
  readonly projection: Readonly<Record<string, 0 | 1>>;

  constructor(projection: Record<string, 0 | 1>) {
    super();
    this.projection = Object.freeze({ ...projection });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.project(this);
  }

  rewrite(_rewriter: MongoFilterRewriter): MongoReadStage {
    return this;
  }
}
```

#### `MongoSortStage`

```typescript
export class MongoSortStage extends MongoStageNode {
  readonly kind = 'sort' as const;
  readonly sort: Readonly<Record<string, 1 | -1>>;

  constructor(sort: Record<string, 1 | -1>) {
    super();
    this.sort = Object.freeze({ ...sort });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sort(this);
  }

  rewrite(_rewriter: MongoFilterRewriter): MongoReadStage {
    return this;
  }
}
```

#### `MongoLimitStage`

```typescript
export class MongoLimitStage extends MongoStageNode {
  readonly kind = 'limit' as const;
  readonly limit: number;

  constructor(limit: number) {
    super();
    this.limit = limit;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.limit(this);
  }

  rewrite(_rewriter: MongoFilterRewriter): MongoReadStage {
    return this;
  }
}
```

#### `MongoSkipStage`

```typescript
export class MongoSkipStage extends MongoStageNode {
  readonly kind = 'skip' as const;
  readonly skip: number;

  constructor(skip: number) {
    super();
    this.skip = skip;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.skip(this);
  }

  rewrite(_rewriter: MongoFilterRewriter): MongoReadStage {
    return this;
  }
}
```

#### `MongoLookupStage`

The `$lookup` stage joins data from another collection. Supports both the basic form (equality join on fields) and the pipeline form (arbitrary sub-pipeline for refinement).

```typescript
export class MongoLookupStage extends MongoStageNode {
  readonly kind = 'lookup' as const;
  readonly from: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly as: string;
  readonly pipeline: ReadonlyArray<MongoReadStage> | undefined;

  constructor(options: {
    from: string;
    localField: string;
    foreignField: string;
    as: string;
    pipeline?: ReadonlyArray<MongoReadStage>;
  }) {
    super();
    this.from = options.from;
    this.localField = options.localField;
    this.foreignField = options.foreignField;
    this.as = options.as;
    this.pipeline = options.pipeline ? Object.freeze([...options.pipeline]) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.lookup(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoReadStage {
    if (!this.pipeline) return this;
    return new MongoLookupStage({
      from: this.from,
      localField: this.localField,
      foreignField: this.foreignField,
      as: this.as,
      pipeline: this.pipeline.map((stage) => stage.rewrite(rewriter)),
    });
  }
}
```

#### `MongoUnwindStage`

Deconstructs an array field. Used after `$lookup` for to-one relations to flatten the joined array to a single document.

```typescript
export class MongoUnwindStage extends MongoStageNode {
  readonly kind = 'unwind' as const;
  readonly path: string;
  readonly preserveNullAndEmptyArrays: boolean;

  constructor(path: string, preserveNullAndEmptyArrays: boolean) {
    super();
    this.path = path;
    this.preserveNullAndEmptyArrays = preserveNullAndEmptyArrays;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.unwind(this);
  }

  rewrite(_rewriter: MongoFilterRewriter): MongoReadStage {
    return this;
  }
}
```

### Exported union

```typescript
export type MongoReadStage =
  | MongoMatchStage
  | MongoProjectStage
  | MongoSortStage
  | MongoLimitStage
  | MongoSkipStage
  | MongoLookupStage
  | MongoUnwindStage;
```

## Visitor and rewriter interfaces

### `MongoFilterVisitor<R>`

Exhaustive visitor — every filter expression kind must be handled. Mirrors SQL's `ExprVisitor<R>`.

```typescript
export interface MongoFilterVisitor<R> {
  field(expr: MongoFieldFilter): R;
  and(expr: MongoAndExpr): R;
  or(expr: MongoOrExpr): R;
  not(expr: MongoNotExpr): R;
  exists(expr: MongoExistsExpr): R;
}
```

### `MongoFilterRewriter`

Optional-hook rewriter — override only the node kinds you want to transform. Mirrors SQL's `ExpressionRewriter`. Each hook receives the node **after** its children have been rewritten (bottom-up).

```typescript
export interface MongoFilterRewriter {
  field?(expr: MongoFieldFilter): MongoFilterExpr;
  and?(expr: MongoAndExpr): MongoFilterExpr;
  or?(expr: MongoOrExpr): MongoFilterExpr;
  not?(expr: MongoNotExpr): MongoFilterExpr;
  exists?(expr: MongoExistsExpr): MongoFilterExpr;
}
```

### `MongoStageVisitor<R>`

Exhaustive visitor over pipeline stages. Useful for the adapter's lowering logic.

```typescript
export interface MongoStageVisitor<R> {
  match(stage: MongoMatchStage): R;
  project(stage: MongoProjectStage): R;
  sort(stage: MongoSortStage): R;
  limit(stage: MongoLimitStage): R;
  skip(stage: MongoSkipStage): R;
  lookup(stage: MongoLookupStage): R;
  unwind(stage: MongoUnwindStage): R;
}
```

### No folder (for now)

SQL's `ExpressionFolder<T>` provides monoid-style aggregation with early exit. This is used for `collectColumnRefs()` and `collectParamRefs()`. The Mongo filter AST doesn't have an equivalent immediate need — MongoDB doesn't have column-qualified references or a param index to collect. If a folder becomes necessary (e.g., for collecting all referenced field names), it can be added later following the SQL pattern.

## Lowering

Lowering translates typed AST nodes into plain `Record<string, unknown>` documents suitable for the MongoDB driver. The lowering functions (`lowerFilter`, `lowerStage`, `lowerPipeline`) live in `mongo-query-ast`. The adapter (`adapter-mongo`) imports these functions and exposes lowering through the `MongoAdapter.lowerReadPlan()` method. The `MongoAdapter` interface in `mongo-core` uses a structural type (`MongoReadPlanLike`) to avoid cross-layer imports of `MongoReadPlan`. `resolveValue` — the shared param-resolution utility — lives in `mongo-core` and is used by both the AST lowering functions and the adapter's command lowering.

### Structure

The AST is structurally close to the driver's document format. Lowering is a thin, largely mechanical translation:

| AST node | Lowered form |
|---|---|
| `MongoFieldFilter('email', '$eq', 'alice')` | `{ email: { $eq: 'alice' } }` |
| `MongoAndExpr([a, b])` | `{ $and: [lower(a), lower(b)] }` |
| `MongoOrExpr([a, b])` | `{ $or: [lower(a), lower(b)] }` |
| `MongoNotExpr(a)` | `{ $nor: [lower(a)] }` |
| `MongoExistsExpr('name', true)` | `{ name: { $exists: true } }` |
| `MongoMatchStage(filter)` | `{ $match: lowerFilter(filter) }` |
| `MongoProjectStage({ name: 1 })` | `{ $project: { name: 1 } }` |
| `MongoSortStage({ age: -1 })` | `{ $sort: { age: -1 } }` |
| `MongoLimitStage(10)` | `{ $limit: 10 }` |
| `MongoSkipStage(5)` | `{ $skip: 5 }` |
| `MongoLookupStage({...})` | `{ $lookup: { from, localField, foreignField, as, pipeline? } }` |
| `MongoUnwindStage('$posts', true)` | `{ $unwind: { path: '$posts', preserveNullAndEmptyArrays: true } }` |

The lowering can be implemented as a `MongoFilterVisitor<Document>` for filters and a `MongoStageVisitor<Record<string, unknown>>` for stages, or as simple switch-based functions. Either approach works; the visitor interfaces are available if the adapter prefers structured dispatch.

### Adapter integration

All lowering is routed through the `MongoAdapter` interface. The `MongoAdapter.lowerReadPlan()` method accepts a `MongoReadPlanLike` (a structural type defined in `mongo-core` to avoid cross-layer imports of `MongoReadPlan`) and calls `lowerPipeline` from `mongo-query-ast` internally. The runtime delegates all lowering to the adapter — both read plans via `lowerReadPlan()` and write commands via `lowerCommand()`. This ensures middleware can intercept all query execution uniformly.

### Param resolution

The existing adapter already handles `MongoParamRef` resolution in `#resolveValue`. The same resolution applies to `MongoValue` instances inside `MongoFieldFilter.value`. The lowering visitor resolves params as it lowers filter expressions — this is the same two-phase approach SQL uses (AST → lowered form, with param resolution during lowering).

## `AggregateCommand` changes

`AggregateCommand` carries typed `MongoReadStage[]` instead of `RawPipeline`:

```typescript
export class AggregateCommand extends MongoCommand {
  readonly kind = 'aggregate' as const;
  readonly pipeline: ReadonlyArray<MongoReadStage>;

  constructor(collection: string, pipeline: ReadonlyArray<MongoReadStage>) {
    super(collection);
    this.pipeline = Object.freeze([...pipeline]);
    this.freeze();
  }
}
```

### Raw pipeline escape hatch

Both typed AST pipelines and raw pipelines must flow through the same `MongoRuntime.execute()` path — the raw escape hatch bypasses the typed AST representation, **not the runtime middleware pipeline**. This mirrors SQL, where both `SqlQueryPlan` (typed AST) and raw `ExecutionPlan` (pre-built SQL string) converge at `executeAgainstQueryable()` and both pass through `RuntimeCore` with its plugin hooks.

**SQL's pattern:**

- `SqlQueryPlan` → `toExecutionPlan()` (lowers AST to SQL) → `executeAgainstQueryable()` → `core.execute()` (plugins)
- `ExecutionPlan` (raw) → `executeAgainstQueryable()` → `core.execute()` (plugins)
- The runtime discriminates structurally: "has `ast` but no `sql`" → needs lowering; otherwise use as-is

**Mongo's equivalent:**

`MongoRuntime.execute()` accepts `MongoQueryPlan | MongoExecutionPlan`. It normalizes to `MongoExecutionPlan` (lowering if needed), then runs middleware and executes:

- `MongoQueryPlan` (typed stages in `AggregateCommand`) → `adapter.lower()` → middleware → `driver.execute()`
- `MongoExecutionPlan` (raw, pre-built `AggregateWireCommand`) → middleware → `driver.execute()`

The current `MongoRuntime` is a thin adapter→driver bridge with no middleware. Adding the middleware pipeline is a prerequisite (or parallel track) to making the raw escape hatch useful — but the plan-level architecture should be designed to support it from the start.

The raw pipeline is constructed as a `MongoExecutionPlan` with a hand-built `AggregateWireCommand` carrying a `RawPipeline`. It bypasses `AggregateCommand` and the typed AST entirely, but still enters the runtime at `execute()`.

## Operations extensibility

### Trait-gated operators

The SQL ORM uses `CodecTrait` (`'equality' | 'order' | 'boolean' | 'numeric' | 'textual'`) to gate which comparison methods appear on `ModelAccessor` fields. `COMPARISON_METHODS_META` maps each method name to its required traits and a factory function that produces an AST node.

The Mongo ORM will use the same pattern. `MONGO_COMPARISON_METHODS_META` maps method names to required traits and factories that produce `MongoFieldFilter` nodes:

```typescript
export const MONGO_COMPARISON_METHODS_META = {
  eq: {
    traits: ['equality'],
    create: (field: string) => (value: MongoValue) => MongoFieldFilter.eq(field, value),
  },
  neq: {
    traits: ['equality'],
    create: (field: string) => (value: MongoValue) => MongoFieldFilter.neq(field, value),
  },
  in: {
    traits: ['equality'],
    create: (field: string) => (values: MongoValue) => MongoFieldFilter.in(field, values),
  },
  gt: {
    traits: ['order'],
    create: (field: string) => (value: MongoValue) => MongoFieldFilter.gt(field, value),
  },
  lt: {
    traits: ['order'],
    create: (field: string) => (value: MongoValue) => MongoFieldFilter.lt(field, value),
  },
  gte: {
    traits: ['order'],
    create: (field: string) => (value: MongoValue) => MongoFieldFilter.gte(field, value),
  },
  lte: {
    traits: ['order'],
    create: (field: string) => (value: MongoValue) => MongoFieldFilter.lte(field, value),
  },
  isNull: {
    traits: [],
    create: (field: string) => () => MongoExistsExpr.notExists(field),
  },
  isNotNull: {
    traits: [],
    create: (field: string) => () => MongoExistsExpr.exists(field),
  },
} as const;
```

The key difference from SQL: SQL's `COMPARISON_METHODS_META.create` receives a `ColumnRef` (an AST node), while Mongo's receives a `field: string` (a field name). This is because MongoDB filters address fields by name directly, not by table-qualified column references.

### Extension operations

Extension packs (e.g., a future geospatial or full-text search pack) register additional operators:

1. Define a new codec with appropriate traits (e.g., `traits: ['equality', 'geospatial']`).
2. Add entries to the comparison methods metadata for the new trait (e.g., `near: { traits: ['geospatial'], create: ... }`).
3. The new operator produces a `MongoFieldFilter` with a custom `op` string (e.g., `$near`, `$geoWithin`).

No changes to the AST classes are needed — `MongoFieldFilter.op` is a `string`, accommodating any operator. The visitor doesn't need to change either, since all field comparisons go through `visitor.field()` regardless of operator.

### Proof of extensibility (Milestone 1 deliverable)

Milestone 1 includes one pass-through extension operator to validate the pattern end-to-end. Concretely, the Mongo target adds a vector data type with one vector operator (e.g., `$near` for vector similarity search):

1. **Codec:** Define a `mongo/vector` codec in the Mongo target with `traits: ['equality', 'vector']`.
2. **Operator registration:** Add a `near` entry to the comparison methods metadata gated by the `'vector'` trait: `{ traits: ['vector'], create: (field) => (value) => MongoFieldFilter.of(field, '$near', value) }`.
3. **Type-level verification:** A field with the `vector` codec gets the `near()` method on `MongoModelAccessor`; fields without the trait do not (type-level test).
4. **Lowering verification:** The adapter lowers `MongoFieldFilter('embedding', '$near', vectorValue)` to `{ embedding: { $near: vectorValue } }` — no special-casing needed since `MongoFieldFilter` lowering is operator-agnostic.

This validates that:
- The open `op: string` design accommodates custom operators without AST changes
- Codec traits correctly gate which operators appear on which fields
- Lowering is operator-agnostic — new operators pass through without adapter changes

## Package

**Package:** `@prisma-next/mongo-query-ast`
**Directory:** `packages/2-mongo-family/2-query/query-ast/`
**Layer:** `query` — a new layer between `core` (1) and `tooling` (3)

The query AST lives in its own package, below all consumers. This prevents coupling the AST to ORM or builder concerns. The Mongo layer order becomes: `["core", "query", "tooling", "lanes", "orm", "runtime", "family"]`.

The layer is named `query` (not `query-ast`) so that other query-representation packages can live alongside the AST in the same layer if needed.

**Why not `mongo-core`?** That package is already a grab-bag of commands, values, codecs, contract types, validation, wire commands, plan types, param refs, driver types, and codec registry. The SQL precedent is clear: the query AST lives in `relational-core` (`@prisma-next/sql-relational-core`) at the lanes layer, not in `sql-core`.

**Why `query-ast` and not `pipeline`?** "Pipeline" is overloaded in this codebase — MongoDB aggregation pipeline, runtime middleware pipeline, emission pipeline. "Query AST" describes what the package contains without ambiguity.

**Import direction:** `mongo-query-ast` imports from `mongo-core` (for `MongoValue`, `MongoParamRef`). Consumers (`mongo-orm`, future pipeline builder, `mongo-adapter`) import from `mongo-query-ast`.

**Layering:** See [mongo-family-layering.md](./mongo-family-layering.md) for the full layer design.

## Module organization

Modules are organized by semantic grouping. No `types.ts` monolith. No `index.ts` barrel files. Each module groups closely related types.

```
src/
├── filter-expressions.ts   MongoFieldFilter, MongoAndExpr, MongoOrExpr, MongoNotExpr,
│                            MongoExistsExpr, MongoFilterExpr union
├── stages.ts                MongoMatchStage, MongoProjectStage, MongoSortStage,
│                            MongoLimitStage, MongoSkipStage, MongoLookupStage,
│                            MongoUnwindStage, MongoReadStage union
├── visitors.ts              MongoFilterVisitor<R>, MongoFilterRewriter, MongoStageVisitor<R>
├── ast-node.ts              MongoAstNode base class (shared by both hierarchies)
└── exports/
    └── index.ts             Public API re-exports (exports/ folder is the exception
                             to the no-barrel rule per repo convention)
```

The hidden abstract bases (`MongoFilterExpression`, `MongoStageNode`) live in their respective modules (`filter-expressions.ts`, `stages.ts`) and are not exported. `MongoAstNode` is in its own module because both hierarchies inherit from it.

## Comparison with SQL AST

| Aspect | SQL (`relational-core`) | Mongo (`mongo-query-ast`) |
|---|---|---|
| Package layer | Lanes (`4-lanes/relational-core`) | `query` (`2-query/query-ast/`) — below consumers |
| Root abstract base | `AstNode` | `MongoAstNode` |
| Expression base | `Expression` (abstract) | `MongoFilterExpression` (abstract) |
| Statement/stage base | `QueryAst` (abstract) | `MongoStageNode` (abstract) |
| Expression union | `AnyExpression` (17 kinds) | `MongoFilterExpr` (5 kinds) |
| Statement/stage union | `AnyQueryAst` (4 kinds) | `MongoReadStage` (7 kinds) |
| Expression visitor | `ExprVisitor<R>` (exhaustive) | `MongoFilterVisitor<R>` (exhaustive) |
| Expression rewriter | `ExpressionRewriter` (optional hooks) | `MongoFilterRewriter` (optional hooks) |
| Expression folder | `ExpressionFolder<T>` (monoid) | Deferred — add if needed |
| Stage visitor | N/A (query-level) | `MongoStageVisitor<R>` (exhaustive) |
| Immutability | `Object.freeze()` in constructor | Same |
| Operator extensibility | `BinaryOp` union + `OperationExpr` | `MongoFieldFilter.op: string` (open) |
| Lowering | Adapter calls `adapter.lower(ast, context)` | Adapter calls `lowerStage(stage)` per stage |
| Pre-lowered plan | `SqlQueryPlan` (has `ast`, no `sql`) | `MongoQueryPlan` (has typed `AggregateCommand`) |
| Raw escape hatch | `ExecutionPlan` with `sql` — still goes through runtime | `MongoExecutionPlan` with `AggregateWireCommand` — still goes through runtime |

## References

- [Phase 1 execution plan](./phase-1-mongo-collection-spike.md)
- [Project spec](../spec.md)
- [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [ADR 175 — Shared ORM Collection interface](../../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)
- SQL AST precedent: [`relational-core/src/ast/types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts)
- SQL codec traits: [`relational-core/src/ast/codec-types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts)
- SQL comparison methods: [`sql-orm-client/src/types.ts`](../../../packages/3-extensions/sql-orm-client/src/types.ts) — `COMPARISON_METHODS_META`
