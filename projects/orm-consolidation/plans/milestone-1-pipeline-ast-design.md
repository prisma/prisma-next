# Milestone 1: Pipeline AST — Design

Implementation design for the typed pipeline AST in `mongo-core`. This document describes the type hierarchies, interfaces, and patterns. For execution order and task breakdown, see [phase-1-mongo-collection-spike.md](./phase-1-mongo-collection-spike.md).

**Precedent:** The SQL AST in [`relational-core/src/ast/types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — class hierarchy, visitor/rewriter/folder interfaces, immutable frozen instances, hidden abstract bases with exported discriminated unions.

**Location:** `packages/2-mongo-family/1-core/src/pipeline/` (new directory within `mongo-core`)

## Design principles

1. **Mirror the SQL AST pattern.** Classes with `kind` discriminant, abstract bases hidden from export, concrete classes exposed via discriminated unions. `accept()` for visitors, `rewrite()` for transformations.
2. **Contract-agnostic.** The AST deals in MongoDB concepts (fields, operators, pipeline stages), not contract concepts (models, codecIds, relations). The ORM bridges the gap.
3. **Lowering in the adapter.** The AST is structurally close to the MongoDB driver's document format. The adapter performs the thin translation from typed nodes to plain documents. `mongo-core` defines the types; the adapter interprets them.
4. **Extensible operators via traits.** Filter operators are strings, not a closed enum. The ORM gates which operators appear on `MongoModelAccessor` fields using codec traits — the same pattern as SQL's `COMPARISON_METHODS_META` + `CodecTrait`.
5. **Raw pipeline is a separate path.** Following SQL's `SqlQueryPlan` (typed AST) vs `ExecutionPlan` (raw SQL string), `AggregateCommand` always carries typed `MongoReadStage[]`. Raw pipelines bypass the typed AST at the plan level.

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

## Pipeline stage AST

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

Lowering translates typed AST nodes into plain `Record<string, unknown>` documents suitable for the MongoDB driver. Per our design decision, **lowering lives in the adapter** (`mongo-adapter`), not in `mongo-core`.

### Why the adapter

The AST is structurally close to the driver's document format. Lowering is a thin, largely mechanical translation:

| AST node | Lowered form |
|---|---|
| `MongoFieldFilter('email', '$eq', 'alice')` | `{ email: { $eq: 'alice' } }` |
| `MongoAndExpr([a, b])` | `{ $and: [lower(a), lower(b)] }` |
| `MongoOrExpr([a, b])` | `{ $or: [lower(a), lower(b)] }` |
| `MongoNotExpr(a)` | `{ $not: lower(a) }` |
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

The adapter's existing `#lowerCommand` method handles each command kind via switch. The `aggregate` case currently does:

```typescript
case 'aggregate':
  return new AggregateWireCommand(
    command.collection,
    command.pipeline.map((stage) => ({ ...stage })),
  );
```

After this change, it will lower typed stages:

```typescript
case 'aggregate':
  return new AggregateWireCommand(
    command.collection,
    command.pipeline.map((stage) => lowerStage(stage)),
  );
```

Where `lowerStage` dispatches on `stage.kind` (or uses `stage.accept(loweringVisitor)`).

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

Following the SQL pattern, raw pipelines bypass the typed AST at the **plan level**, not inside `AggregateCommand`.

SQL has two plan shapes:

- `SqlQueryPlan` — has `ast: AnyQueryAst`, no `sql` (pre-lowering)
- `ExecutionPlan` — has `sql: string`, optional `ast` (raw or post-lowering)

The runtime discriminates structurally: "has `ast` but no `sql`" → needs lowering.

Mongo's equivalent:

- `MongoQueryPlan` — has `command: AnyMongoCommand` where `AggregateCommand` carries typed `MongoReadStage[]` (pre-lowering)
- `MongoExecutionPlan` — has `wireCommand: AnyMongoWireCommand` where `AggregateWireCommand` carries `RawPipeline` (raw or post-lowering)

A raw pipeline is constructed directly as a `MongoExecutionPlan` with a hand-built `AggregateWireCommand`, bypassing the typed AST entirely. This mirrors how raw SQL creates an `ExecutionPlan` with `sql` already filled in and no `ast`.

The existing `MongoQueryPlan` → `MongoExecutionPlan` flow already supports this: the adapter's `lower()` converts one to the other. A raw pipeline would skip `lower()` and construct `MongoExecutionPlan` directly.

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

## File organization

New files within `packages/2-mongo-family/1-core/src/pipeline/`:

```
pipeline/
├── types.ts            Filter expressions, pipeline stages, unions, visitors, rewriters
└── index.ts            Re-exports from types.ts
```

Everything in a single `types.ts` file, matching the SQL AST's `relational-core/src/ast/types.ts` pattern. The file is small enough (two hierarchies, ~12 classes) that splitting would be premature.

Exports are added to `packages/2-mongo-family/1-core/src/exports/index.ts` to make the types available to consumers (`mongo-orm`, `mongo-adapter`).

## Comparison with SQL AST

| Aspect | SQL (`relational-core`) | Mongo (`mongo-core`) |
|---|---|---|
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
| Raw escape hatch | `ExecutionPlan` with `sql` (no `ast`) | `MongoExecutionPlan` with `AggregateWireCommand` |

## References

- [Phase 1 execution plan](./phase-1-mongo-collection-spike.md)
- [Project spec](../spec.md)
- [ADR 183 — Aggregation pipeline only, never find API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)
- [ADR 175 — Shared ORM Collection interface](../../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)
- SQL AST precedent: [`relational-core/src/ast/types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts)
- SQL codec traits: [`relational-core/src/ast/codec-types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts)
- SQL comparison methods: [`sql-orm-client/src/types.ts`](../../../packages/3-extensions/sql-orm-client/src/types.ts) — `COMPARISON_METHODS_META`
