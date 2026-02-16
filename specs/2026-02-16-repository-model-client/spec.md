# Model Client / Repository Pattern

**Package:** `@prisma-next/sql-repositories` (`packages/2-sql/6-repositories/`)
**Layer:** 6 (Repository), Runtime Plane
**Status:** Draft
**Date:** 2026-02-16
**References:** ADR 161 (Repository Layer), ADR 015 (ORM as Optional Extension), PR #152 (AST expansion)

---

## 1. Overview

The Repository Model Client is a high-level, type-safe, fluent data access API for Prisma Next. It speaks in **application-developer terms** -- models, fields, relations -- rather than database terms like tables, columns, and rows. It provides the primary end-user API for reading and writing data through Prisma Next contracts.

### Goals

1. **Fluent, immutable query builder** -- each method returns a new `Collection`, enabling safe composition and reuse of partial queries.
2. **Contract-derived type safety** -- all types (row shapes, field accessors, relation names, unique constraints) are derived from the contract artifact at the type level.
3. **Abstract filter expressions** -- filters produce PN AST `WhereExpr` nodes, the same type that lanes and adapters consume. Users can compose, share, and extend filter logic with no coupling to the internal query builder.
4. **Capability-driven execution** -- the include strategy (lateral joins, correlated subqueries, or multi-query stitching) is selected deterministically from contract capabilities. No runtime feature detection.
5. **Safe mutations** -- `update()` and `delete()` require an explicit `where()` filter (or `where(all())` for whole-table operations) to prevent accidental bulk mutations.
6. **Custom repositories** -- domain-specific subclasses of `Repository` encapsulate reusable query patterns as named methods, with no complex generic requirements.
7. **No public Kysely dependency** -- Kysely is used internally as the low-level query builder via `@prisma-next/integration-kysely`. Query compilation and SQL lowering happen in that integration package, not in the repository layer. No Kysely type appears in the public API surface.

### Non-Goals

- Transactions (deferred to TML-1912)
- Error handling taxonomy / `findUniqueOrThrow` (deferred to TML-1911)
- Raw SQL escape hatch (use the DSL lane or driver directly)
- Computed fields or renaming within `select()`
- Opaque cursor tokens
- M:N junction table traversal strategies

---

## 2. Architecture

### 2.1 Package Location and Plane

The repository layer lives at `packages/2-sql/6-repositories/` in the **runtime plane**. Per ADR 161, it occupies layer 6 in the package layering model, above lanes (layer 4) and the SQL runtime (layer 5).

### 2.2 Dependency Boundaries

Per ADR 161 section 2:

| Direction | Allowed |
|-----------|---------|
| **May import from** | Lanes (layer 4), SQL runtime (layer 5), contract, operations, `runtime-executor` |
| **Must not import** | Adapters, drivers (consumed by runtime, not repositories) |
| **Must not be imported by** | Lower layers (lanes, runtime core, adapters, drivers) |

Current dependencies (from `package.json`):

- `@prisma-next/contract` -- `ExecutionPlan` type and contract metadata
- `@prisma-next/runtime-executor` -- `AsyncIterableResult`
- `@prisma-next/sql-contract` -- `SqlContract`, `SqlStorage`, `StorageColumn` types
- `@prisma-next/sql-relational-core` -- `ComputeColumnJsType`, PN AST types (`WhereExpr`, etc.)
- `@prisma-next/sql-runtime` -- `Runtime` type (for integration with the runtime queryable)
- `@prisma-next/integration-kysely` -- Kysely-based query building, AST conversion, and plan execution

### 2.3 Query Building and Execution

The repository layer uses Kysely as the **internal low-level query builder** via `@prisma-next/integration-kysely`. The repository layer builds Kysely queries from `CollectionState`, and the integration package handles:

- Converting the Kysely AST to PN `QueryAst` (PR #152)
- Compiling SQL strings from the AST
- Producing `ExecutionPlan` instances for the runtime

The repository layer does **not** perform SQL lowering or compilation itself — that is not its responsibility. No Kysely type appears in any public type signature, function parameter, or return type.

The execution boundary:

```
CollectionState (internal)
    |
    v
Kysely query builder (internal) --> @prisma-next/integration-kysely
    |                                   |
    |                                   v
    |                               PN QueryAst --> SQL compilation --> ExecutionPlan
    v
RuntimeQueryable.execute(plan)
```

### 2.4 Filter Expressions as PN AST Nodes

The existing internal `FilterExpr` type (`{ column, op, value }`) is replaced by the PN AST `WhereExpr` union type from `@prisma-next/sql-relational-core`. This means:

- Filter expressions produced by the column accessor, standalone functions (`and`, `or`, `not`), and user-defined filter functions are all the same `WhereExpr` type.
- The repository layer translates `WhereExpr` nodes to Kysely `where()` calls when building queries. The integration package then converts back to PN AST for compilation.
- Filters are composable, serializable, and inspectable as data.

With PR #152, the `WhereExpr` type expands to:

```typescript
type BinaryOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'like' | 'ilike' | 'in' | 'notIn';

interface BinaryExpr {
  kind: 'bin';
  op: BinaryOp;
  left: Expression;
  right: Expression | ParamRef | LiteralExpr | ListLiteralExpr;
}

interface ListLiteralExpr {
  kind: 'listLiteral';
  values: ReadonlyArray<ParamRef | LiteralExpr>;
}

interface AndExpr { kind: 'and'; exprs: ReadonlyArray<WhereExpr>; }
interface OrExpr { kind: 'or'; exprs: ReadonlyArray<WhereExpr>; }

type WhereExpr = BinaryExpr | ExistsExpr | NullCheckExpr | AndExpr | OrExpr;
```

### 2.5 Capability-Based Include Strategy

Include execution follows a capability-based strategy hierarchy, read from the contract:

| Priority | Strategy | Requirements | Queries |
|----------|----------|-------------|---------|
| 1 (preferred) | Lateral joins + JSON aggregation | `lateral`, `jsonAgg` capabilities | Single query using `IncludeAst` |
| 2 (fallback) | Correlated subqueries + JSON aggregation | `jsonAgg` capability | Single query |
| 3 (last resort) | Multi-query stitching | None (universal fallback) | N+1 queries, connection-pinned |

Strategy selection is **deterministic** given the same contract and capabilities. Per-parent `limit`/`offset` in includes moves to SQL when using lateral or correlated approaches; it is applied in-memory only for the multi-query fallback path.

Currently only Postgres is a supported target, but the design accommodates future targets by inspecting capabilities rather than hard-coding target names.

The fallback path is testable by providing a contract with disabled capabilities.

### 2.6 RuntimeExecutor Plugin Lifecycle

Repository operations participate in the `RuntimeExecutor` plugin lifecycle hooks:

- Each `ExecutionPlan` dispatched by the repository passes through `beforeCompile` and `afterExecute` hooks.
- Plans produced by the repository layer use `meta.lane = 'repository'` to distinguish them from direct lane usage.
- Repository-level operation telemetry aggregates individual Plan telemetry into an operation-level summary (per ADR 161 section 8).

---

## 3. Core Types and Type System

### 3.1 Contract-Derived Types

All types are extracted from the contract type parameter. These types exist today and are extended as needed.

```typescript
/** All scalar fields of a model with their JS types. */
type DefaultModelRow<TContract, ModelName> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]:
    FieldJsType<TContract, ModelName, K>;
};

/** Field definitions for a model. */
type FieldsOf<TContract, ModelName> = /* extracted from TContract['models'][ModelName]['fields'] */;

/** Typed relations with cardinality for a model. */
type RelationsOf<TContract, ModelName> = /* extracted from TContract['relations'] or legacy model relations */;

/** Relation names available on a model. */
type RelationNames<TContract, ModelName> = keyof RelationsOf<TContract, ModelName> & string;

/** The related model name for a given relation. */
type RelatedModelName<TContract, ModelName, RelName> = /* extracted from relation definition */;
```

#### Relation Cardinality

The contract stores cardinality metadata on relation definitions (e.g., `cardinality: '1:N'` or `cardinality: '1:1'`). This is used at the type level to determine include result shapes:

```typescript
type RelationCardinality<TContract, ModelName, RelName> =
  /* extracted from RelationsOf<TContract, ModelName>[RelName]['cardinality'] */;

// 1:1 or N:1 relations return Row | null
// 1:N or M:N relations return Row[]
type IncludeResultType<Cardinality, Row> =
  Cardinality extends '1:1' | 'N:1' ? Row | null :
  Cardinality extends '1:N' | 'M:N' ? Row[] :
  Row[];
```

#### Unique Constraint Types

For `findUnique()`, a discriminated union is derived from the contract's primary key and unique constraints:

```typescript
// Given a model with:
//   primaryKey: { columns: ['id'] }
//   uniques: [{ columns: ['email'] }, { columns: ['tenantId', 'slug'] }]
//
// The derived type is:
type UserUniqueCriterion =
  | { id: number }
  | { email: string }
  | { tenantId: string; slug: string };
```

This type is computed from `TContract['storage']['tables'][TableName]` at the type level.

#### Create Input Types

For `create()`, the input type distinguishes required vs optional fields based on contract metadata (nullability, defaults, generated values):

```typescript
type CreateInput<TContract, ModelName> = {
  // Required: non-nullable fields without defaults
  [K in RequiredCreateFields<TContract, ModelName>]:
    FieldJsType<TContract, ModelName, K>;
} & {
  // Optional: nullable fields, fields with defaults, auto-generated fields
  [K in OptionalCreateFields<TContract, ModelName>]?:
    FieldJsType<TContract, ModelName, K>;
};
```

### 3.2 Filter Expression System

#### WhereExpr as the Universal Filter Type

All filter-producing APIs return `WhereExpr` from the PN AST. This is the single type that flows from the user-facing API to the internal query builder.

#### Three `where()` Overloads

```typescript
class Collection<TContract, ModelName, Row> {
  // Overload 1: Callback with typed ModelAccessor
  where(fn: (model: ModelAccessor<TContract, ModelName>) => WhereExpr): Collection<...>;

  // Overload 2: Direct AST node
  where(expr: WhereExpr): Collection<...>;

  // Overload 3: Shorthand equality object
  where(criterion: Partial<FieldEqualityCriterion<TContract, ModelName>>): Collection<...>;
}
```

The shorthand object overload (`{ field: value }`) desugars to an `AndExpr` of `BinaryExpr` nodes with `op: 'eq'`:

```typescript
// This:
db.users.where({ role: 'admin', active: true })

// Produces the equivalent of:
db.users.where(u => and(u.role.eq('admin'), u.active.eq(true)))
```

Shorthand behavior:
- Multiple fields in the same object are combined with AND.
- `null` values produce `NullCheckExpr` with `isNull: true`.
- Nested objects are not supported (use the callback overload for relational filters).

#### Standalone Logical Functions

```typescript
import { and, or, not } from '@prisma-next/sql-repositories';

// and(): combines multiple WhereExpr with AND
function and(...exprs: WhereExpr[]): AndExpr;

// or(): combines multiple WhereExpr with OR
function or(...exprs: WhereExpr[]): OrExpr;

// not(): negates a WhereExpr
// For BinaryExpr: inverts the operator (eq -> neq, gt -> lte, etc.)
// For ExistsExpr: flips the `not` flag
// For NullCheckExpr: flips the `isNull` flag
// For AndExpr/OrExpr: wraps in NOT (implementation detail)
function not(expr: WhereExpr): WhereExpr;
```

These are the fundamental combinators. Column accessor methods delegate to them:

```typescript
// u.name.eq('Alice') produces:
{
  kind: 'bin',
  op: 'eq',
  left: { kind: 'col', table: 'users', column: 'name' },
  right: { kind: 'param', index: 0 }
}
```

#### `all()` Sentinel

```typescript
import { all } from '@prisma-next/sql-repositories';

// Sentinel value indicating "match all rows" (no WHERE clause)
function all(): WhereExpr;

// Required for whole-table mutations:
db.users.where(all()).delete();
```

`all()` returns a special sentinel `WhereExpr` node that the compiler recognizes and omits from the generated SQL.

#### User-Defined Filter Functions

Because filters are plain `WhereExpr` data, users can write reusable filter factories:

```typescript
import { and, type WhereExpr } from '@prisma-next/sql-repositories';

function activeAdmins<T extends { role: { eq(v: string): WhereExpr }; active: { eq(v: boolean): WhereExpr } }>(
  accessor: T,
): WhereExpr {
  return and(accessor.role.eq('admin'), accessor.active.eq(true));
}

// Usage:
db.users.where(u => activeAdmins(u)).findMany();
```

### 3.3 ModelAccessor

The `ModelAccessor` is a unified proxy type that combines **scalar field comparisons** and **relation accessors** on a single object. It replaces the current `ColumnAccessor` type.

```typescript
type ModelAccessor<TContract, ModelName> = {
  // Scalar fields: typed comparison methods
  [K in keyof FieldsOf<TContract, ModelName> & string]:
    ScalarFieldAccessor<FieldJsType<TContract, ModelName, K>>;
} & {
  // Relations: relational filter methods
  [K in RelationNames<TContract, ModelName>]:
    RelationFilterAccessor<TContract, RelatedModelName<TContract, ModelName, K>>;
};
```

#### Scalar Field Accessor

```typescript
interface ScalarFieldAccessor<T> {
  // Basic comparisons
  eq(value: T): WhereExpr;
  neq(value: T): WhereExpr;
  gt(value: T): WhereExpr;
  lt(value: T): WhereExpr;
  gte(value: T): WhereExpr;
  lte(value: T): WhereExpr;

  // String operators (available when T extends string)
  like(pattern: string): WhereExpr;
  ilike(pattern: string): WhereExpr;

  // List operators
  in(values: T[]): WhereExpr;
  notIn(values: T[]): WhereExpr;

  // Null checks (available when field is nullable)
  isNull(): WhereExpr;
  isNotNull(): WhereExpr;

  // OrderBy accessors (used in orderBy callback)
  asc(): OrderByDirective;
  desc(): OrderByDirective;
}
```

Note: `like`, `ilike`, `in`, `notIn` correspond to the expanded `BinaryOp` from PR #152. `isNull`/`isNotNull` produce `NullCheckExpr` nodes.

#### Relation Filter Accessor

```typescript
interface RelationFilterAccessor<TContract, RelatedModelName> {
  // EXISTS subquery: true if ANY related record matches
  some(predicate?: (related: ModelAccessor<TContract, RelatedModelName>) => WhereExpr): WhereExpr;

  // NOT EXISTS with negated predicate: true if ALL related records match
  every(predicate: (related: ModelAccessor<TContract, RelatedModelName>) => WhereExpr): WhereExpr;

  // NOT EXISTS subquery: true if NO related record matches
  none(predicate?: (related: ModelAccessor<TContract, RelatedModelName>) => WhereExpr): WhereExpr;
}
```

Relational filter methods produce `ExistsExpr` nodes with constructed subqueries:

```typescript
// db.users.where(u => u.posts.some(p => p.published.eq(true)))
// Produces:
{
  kind: 'exists',
  not: false,
  subquery: {
    kind: 'select',
    from: { kind: 'table', name: 'posts' },
    project: [{ alias: '1', expr: { kind: 'literal', value: 1 } }],
    where: {
      kind: 'and',
      exprs: [
        // Join condition: posts.user_id = users.id
        { kind: 'bin', op: 'eq',
          left: { kind: 'col', table: 'posts', column: 'user_id' },
          right: { kind: 'col', table: 'users', column: 'id' } },
        // User predicate: posts.published = true
        { kind: 'bin', op: 'eq',
          left: { kind: 'col', table: 'posts', column: 'published' },
          right: { kind: 'param', index: 0 } },
      ]
    }
  }
}
```

`some()` without a predicate checks for the existence of any related record. `every()` requires a predicate (it does not make sense to say "every related record matches nothing"). `none()` without a predicate checks that no related records exist.

The nested predicate accepts the same three `where()` overloads (callback, AST node, shorthand object). Nesting is unbounded -- a relational predicate can reference further relations.

### 3.4 Type-State Tracking

The `Collection` class carries generic type parameters that track query builder state for compile-time method gating. Complex intermediate types are acceptable; **user-facing types remain simple**.

```typescript
class Collection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState = DefaultState,
> {
  // ...
}
```

Where `CollectionTypeState` tracks:

```typescript
interface CollectionTypeState {
  hasOrderBy: boolean;
  hasWhere: boolean;
  hasUniqueFilter: boolean;
}

type DefaultState = {
  hasOrderBy: false;
  hasWhere: false;
  hasUniqueFilter: false;
};
```

#### Methods Gated by Type-State

| Method | Requires |
|--------|----------|
| `findUnique(criterion)` | Always available (takes its own unique criterion) |
| `cursor({ field: value })` | `hasOrderBy: true` |
| `distinctOn(...fields)` | `hasOrderBy: true` |
| `update(data)` | `hasWhere: true` |
| `delete()` | `hasWhere: true` |
| `updateMany(data)` | `hasWhere: true` |
| `deleteMany()` | `hasWhere: true` |

When `where()` is called, the returned Collection's `State` updates `hasWhere` to `true`. When `orderBy()` is called, `hasOrderBy` updates to `true`.

#### Keeping Extensions Simple

Custom repository subclasses should not need to spell out complex type-state generics. The base `Repository` class provides sensible defaults:

```typescript
class UserRepository extends Repository<Contract, 'User'> {
  admins() {
    // Return type is inferred -- no explicit generics needed
    return this.where(u => u.kind.eq('admin'));
  }
}
```

The complex type-state parameters are inferred automatically through method chaining.

---

## 4. Read API

### 4.1 Collection (Query Builder)

`Collection` is the immutable, fluent, chainable query builder. Every method returns a **new** Collection instance; the original is never mutated. This enables safe composition patterns like storing a base query and deriving multiple variants from it.

#### Method Reference

##### `where(fn | expr | object)`

Appends a filter condition. Multiple `where()` calls are combined with AND.

```typescript
// Callback (typed accessor)
db.users.where(u => u.email.eq('alice@example.com'))

// Direct AST node
db.users.where({ kind: 'bin', op: 'eq', left: emailCol, right: paramRef })

// Shorthand equality object
db.users.where({ role: 'admin' })

// Multiple where() calls are AND-ed
db.users
  .where(u => u.role.eq('admin'))
  .where(u => u.active.eq(true))
```

##### `include(relation, refine?)`

Loads related records. Cardinality-aware return types.

```typescript
// Basic include
db.users.include('posts')
// Result type: { ...UserFields, posts: PostRow[] }

// 1:1 include
db.posts.include('author')
// Result type: { ...PostFields, author: UserRow | null }

// Include with refinement
db.users.include('posts', p =>
  p.where(post => post.published.eq(true))
   .orderBy(post => post.createdAt.desc())
   .take(5)
)

// Multiple includes
db.users
  .include('posts')
  .include('profile')
// Result type: { ...UserFields, posts: PostRow[], profile: ProfileRow | null }

// Nested includes
db.users.include('posts', p =>
  p.include('comments', c =>
    c.where(comment => comment.approved.eq(true))
  )
)
```

##### `select(...fields)`

Projects specific scalar fields on the current model. Narrows the result type.

```typescript
db.users.select('name', 'email')
// Result type: { name: string; email: string }

// Select + include are complementary
db.users
  .select('name', 'email')
  .include('posts')
// Result type: { name: string; email: string; posts: PostRow[] }

// Nested select within include
db.users.include('posts', p => p.select('title', 'createdAt'))
// Result type: { ...UserFields, posts: { title: string; createdAt: Date }[] }
```

`select()` narrows the `Row` type parameter to only the specified fields. Calling `select()` multiple times replaces the previous selection (last call wins), since intersecting narrowed types would be confusing.

##### `orderBy(fn | array)`

Orders results using typed field accessors.

```typescript
// Single column
db.users.orderBy(u => u.createdAt.desc())

// Multi-column via array
db.users.orderBy([
  u => u.lastName.asc(),
  u => u.firstName.asc(),
])

// Chained orderBy appends to the order list
db.users
  .orderBy(u => u.lastName.asc())
  .orderBy(u => u.firstName.asc())
```

##### `take(n)` / `skip(n)`

Offset-based pagination.

```typescript
db.users
  .orderBy(u => u.createdAt.desc())
  .skip(20)
  .take(10)
```

##### `cursor({ field: value })`

Cursor-based pagination using explicit field+value pairs. Requires `orderBy` to have been called (enforced at the type level via type-state).

```typescript
db.users
  .orderBy(u => u.id.asc())
  .cursor({ id: 42 })
  .take(10)
// Returns 10 users with id > 42

// Without orderBy -- type error:
db.users.cursor({ id: 42 })
//       ^^^^^^ Error: cursor() requires orderBy to be set
```

The cursor implementation compiles to a `WHERE id > $1` (or `<` for descending order) clause combined with the existing `orderBy` direction. For compound cursors (multi-column orderBy), the compiler generates the appropriate tuple comparison.

##### `distinct(...fields)`

SELECT DISTINCT on the specified columns.

```typescript
db.users.distinct('role')
// SELECT DISTINCT ON... (or just deduplication in result set)
```

##### `distinctOn(...fields)`

Postgres-specific `DISTINCT ON`. Requires `orderBy` (type-state gated) because `DISTINCT ON` semantics depend on ordering.

```typescript
db.users
  .orderBy(u => u.createdAt.desc())
  .distinctOn('email')
// SELECT DISTINCT ON ("email") ... ORDER BY "created_at" DESC
```

##### `findMany()`

Terminal method. Executes the query and returns results.

```typescript
// Streaming (async iterable)
for await (const user of db.users.where(u => u.active.eq(true)).findMany()) {
  console.log(user);
}

// Collect into array (thenable shorthand)
const users: UserRow[] = await db.users
  .where(u => u.active.eq(true))
  .findMany();
```

**Return type:** `findMany()` returns `AsyncIterableResult<Row>`, which implements both the async iterable protocol (`for await...of`) and the thenable protocol (`await` resolves to `Row[]`). This preserves streaming as a first-class capability while eliminating `.toArray()` boilerplate for the common case.

##### `findFirst()`

Terminal method. Returns the first matching record or `null`.

```typescript
const user: UserRow | null = await db.users
  .where(u => u.email.eq('alice@example.com'))
  .findFirst();
```

Compiles to `LIMIT 1` and unwraps the single result.

##### `findUnique(criterion)`

Terminal method. Accepts a type-safe unique criterion derived from the contract's primary key and unique constraints. Returns `Promise<Row | null>`.

```typescript
// By primary key
const user = await db.users.findUnique({ id: 42 });

// By unique constraint
const user = await db.users.findUnique({ email: 'alice@example.com' });

// Compound unique
const post = await db.posts.findUnique({ tenantId: 'acme', slug: 'hello-world' });
```

`findUnique()` is available directly on the Collection/Repository without requiring prior `where()` calls. It is a standalone terminal method that accepts the complete unique criterion as its argument.

The criterion type is a discriminated union derived from the contract:

```typescript
findUnique(
  criterion: UniqueConstraintCriterion<TContract, ModelName>
): Promise<(Row & IncludedRelations) | null>;
```

`findUnique()` composes with `select()` and `include()`:

```typescript
const user = await db.users
  .select('name', 'email')
  .include('posts')
  .findUnique({ id: 42 });
// Type: { name: string; email: string; posts: PostRow[] } | null
```

### 4.2 Include Strategy (Capability-Based)

The include system selects its execution strategy based on contract capabilities (see section 2.5).

#### Strategy 1: Lateral Joins + JSON Aggregation

Compiles the parent query and all includes into a single `SelectAst` with `IncludeAst` nodes. The adapter lowers these to `LATERAL JOIN` + `json_agg()` in Postgres. This produces a single SQL statement.

```sql
SELECT u.*, (
  SELECT json_agg(sub.*)
  FROM LATERAL (
    SELECT p.*
    FROM posts p
    WHERE p.user_id = u.id
    ORDER BY p.created_at DESC
    LIMIT 5
  ) sub
) AS "posts"
FROM users u
WHERE u.active = true
```

Per-parent `limit`/`offset` in includes is expressed directly in the lateral subquery.

#### Strategy 2: Correlated Subqueries + JSON Aggregation

When lateral joins are unavailable but JSON aggregation is supported, the compiler rewrites includes as correlated subqueries:

```sql
SELECT u.*, (
  SELECT json_agg(sub.*)
  FROM (
    SELECT p.*
    FROM posts p
    WHERE p.user_id = u.id
    ORDER BY p.created_at DESC
    LIMIT 5
  ) sub
) AS "posts"
FROM users u
WHERE u.active = true
```

#### Strategy 3: Multi-Query Stitching (Fallback)

When neither capability is available, the repository dispatches separate queries per included relation and stitches results in memory. Queries are dispatched within a **pinned connection** (using `runtime.connection()`) for read consistency.

This is the current implementation in `collection.ts`:

1. Execute parent query.
2. Collect parent primary key values.
3. For each include: execute `SELECT * FROM <related> WHERE <fk> IN ($parentPks)`.
4. Group child rows by FK value and stitch onto parent rows.
5. Apply per-parent `limit`/`offset` in memory via `slicePerParent()`.

### 4.3 Relational Filters

Relational filters allow filtering parent records based on conditions on related records.

```typescript
// Users who have at least one published post
db.users.where(u => u.posts.some(p => p.published.eq(true)))

// Users where ALL posts are published
db.users.where(u => u.posts.every(p => p.published.eq(true)))

// Users with no posts
db.users.where(u => u.posts.none())

// Users with no published posts
db.users.where(u => u.posts.none(p => p.published.eq(true)))
```

#### Compilation

- `some(predicate)` compiles to `EXISTS (SELECT 1 FROM <related> WHERE <join> AND <predicate>)`.
- `every(predicate)` compiles to `NOT EXISTS (SELECT 1 FROM <related> WHERE <join> AND NOT (<predicate>))`.
- `none(predicate?)` compiles to `NOT EXISTS (SELECT 1 FROM <related> WHERE <join> [AND <predicate>])`.

#### Nested Relational Filters

Relational filters can be nested to arbitrary depth:

```typescript
// Users who have a post with an approved comment
db.users.where(u =>
  u.posts.some(p =>
    p.comments.some(c => c.approved.eq(true))
  )
)
```

Each nesting level constructs a deeper `ExistsExpr` with a subquery that references the next relation in the chain.

---

## 5. Mutation API

### 5.1 Single-Model Mutations

Mutations are methods on the Collection/Repository that modify data. They respect the `where()` filters accumulated on the collection.

#### `create(data)`

Inserts a new record. The data type is derived from the contract, distinguishing required fields (non-nullable, no default) from optional fields (nullable, has default, auto-generated).

```typescript
const user = await db.users.create({
  email: 'alice@example.com',  // required
  name: 'Alice',               // required
  // id: auto-generated, optional
  // createdAt: has default, optional
});
// Return type: UserRow (the created record)
```

`create()` compiles to an `INSERT ... RETURNING *` when the target supports `RETURNING`. When `RETURNING` is unavailable, the repository orchestrates `INSERT` followed by `SELECT` using the known key (per ADR 161 section 5).

#### `update(data)`

Updates records matching the current `where()` filters. **Requires at least one `where()` filter** (type-state gated: `hasWhere: true`).

```typescript
await db.users
  .where(u => u.id.eq(42))
  .update({ name: 'Alice Updated' });

// Type error -- no where() applied:
await db.users.update({ name: 'Alice Updated' });
//              ^^^^^^ Error: update() requires where() to be called first

// Whole-table update requires explicit all():
await db.users.where(all()).update({ active: false });
```

The update data type accepts partial fields -- only the fields being updated need to be specified:

```typescript
type UpdateInput<TContract, ModelName> = Partial<
  Omit<DefaultModelRow<TContract, ModelName>, /* auto-generated fields */>
>;
```

#### `delete()`

Deletes records matching the current `where()` filters. **Requires at least one `where()` filter** (type-state gated).

```typescript
await db.users.where(u => u.id.eq(42)).delete();

// Type error -- no where():
await db.users.delete();

// Whole-table delete:
await db.users.where(all()).delete();
```

#### `upsert({ create, update })`

Insert or update based on conflict. Compiles to `INSERT ... ON CONFLICT DO UPDATE`.

```typescript
const user = await db.users
  .upsert({
    create: { email: 'alice@example.com', name: 'Alice' },
    update: { name: 'Alice Updated' },
  });
```

The conflict target is derived from the unique constraints in the contract. When multiple unique constraints exist, an explicit `conflictOn` field may be required:

```typescript
const user = await db.users
  .upsert({
    conflictOn: 'email',  // which unique constraint to use
    create: { email: 'alice@example.com', name: 'Alice' },
    update: { name: 'Alice Updated' },
  });
```

### 5.2 Batch Operations

#### `createMany(data[])`

Bulk insert. Compiles to a multi-row `INSERT`.

```typescript
const count = await db.users.createMany([
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
]);
// Returns: number (count of inserted records)
```

#### `updateMany(data)`

Bulk update matching filters. Same safety guardrail as `update()` -- requires `where()`.

```typescript
const count = await db.users
  .where(u => u.role.eq('guest'))
  .updateMany({ active: false });
// Returns: number (count of updated records)
```

#### `deleteMany()`

Bulk delete matching filters. Same safety guardrail as `delete()` -- requires `where()`.

```typescript
const count = await db.users
  .where(u => u.active.eq(false))
  .deleteMany();
// Returns: number (count of deleted records)
```

### 5.3 Mutation Result Variants

A key design question is how to distinguish between mutations that return the affected record(s) versus mutations that return an affected count. The API must avoid SQL-specific terminology ("rows", "returning") and speak in application-developer terms.

The confirmed direction is a **method-based approach**. Several naming options are documented here for team discussion.

#### Option A: Default Record Return, Chain for Count

The primary mutation methods (`create`, `update`, `delete`) return the record(s) by default. A chained `.count()` variant returns just the count.

```typescript
// Returns the created record
const user = await db.users.create({ name: 'Alice', email: 'a@e.com' });

// Returns just the count
const count = await db.users.where(u => u.active.eq(false)).delete().count();
```

Pros: Natural default (most users want the record). No method explosion.
Cons: `.count()` after `.delete()` may read oddly. Requires the base mutation to return a "pending" object.

#### Option B: Separate Named Methods

```typescript
// Record-returning
const user = await db.users.create({ name: 'Alice', email: 'a@e.com' });

// Count-returning
const count = await db.users.where(u => u.active.eq(false)).deleteCount();
```

Pros: Explicit and unambiguous.
Cons: Method explosion (create/createCount, update/updateCount, delete/deleteCount, etc.).

#### Option C: Execution Modifier

```typescript
// Returns record(s)
const user = await db.users.create({ name: 'Alice', email: 'a@e.com' }).get();

// Returns count
const count = await db.users.where(u => u.active.eq(false)).delete().exec();
```

Pros: Clean separation.
Cons: Extra method call for the common case.

**Recommendation:** Explore Option A, where the common-case return is the record and count is available via a chaining modifier. Final naming requires team alignment.

#### Select/Include on Mutations

`select()` and `include()` compose with mutations to control what data is returned:

```typescript
// Select specific fields from the created record
const result = await db.users
  .create({ name: 'Alice', email: 'a@e.com' })
  .select('id', 'email');
// Type: { id: number; email: string }

// Include relations on the created record
const result = await db.users
  .create({ name: 'Alice', email: 'a@e.com' })
  .include('posts');
// Type: { ...UserFields, posts: PostRow[] }
```

When `select()` or `include()` is used on a mutation, the mutation uses `RETURNING` (or equivalent) to return the specified fields, then performs any include stitching as needed.

### 5.4 Nested Mutations

Two styles of nested mutations are supported, serving different ergonomic needs.

#### Fluent Chain Style

Navigate from a parent record to a related repository and perform mutations.

```typescript
// Create a comment on a specific post
await db.posts
  .findUnique({ id: postId })
  .comments
  .create({ body: 'Great post!' });

// Update comments on a specific post
await db.posts
  .findUnique({ id: postId })
  .comments
  .where(c => c.approved.eq(false))
  .update({ approved: true });
```

The fluent chain constructs the foreign key relationship automatically. `findUnique({ id: postId }).comments` produces a Collection scoped to comments where `post_id = postId`.

#### Nested Payload Style

Provide related record mutations inline with the parent mutation payload.

```typescript
// Create a user with posts in a single operation
const user = await db.users.create({
  name: 'Alice',
  email: 'alice@example.com',
  posts: {
    create: [
      { title: 'First Post' },
      { title: 'Second Post' },
    ],
  },
});

// Create a post and connect to existing author
const post = await db.posts.create({
  title: 'New Post',
  author: {
    connect: { id: authorId },
  },
});
```

Nested mutation operations:
- `create` -- create new related records
- `connect` -- link to existing records by unique criterion
- `disconnect` -- unlink related records (set FK to null where allowed)

Nested payloads are executed within a **transaction** by default (per ADR 161 section 6), orchestrating multiple INSERT statements with propagated generated keys.

The nested payload type for a relation extends the create input:

```typescript
type CreateInputWithRelations<TContract, ModelName> = CreateInput<TContract, ModelName> & {
  [K in RelationNames<TContract, ModelName>]?: {
    create?: CreateInput<TContract, RelatedModelName<TContract, ModelName, K>>
           | CreateInput<TContract, RelatedModelName<TContract, ModelName, K>>[];
    connect?: UniqueConstraintCriterion<TContract, RelatedModelName<TContract, ModelName, K>>;
  };
};
```

---

## 6. Aggregations

### 6.1 Simple Aggregations on Collection

Aggregation methods are terminal methods on Collection that return scalar values rather than rows.

```typescript
// Count
const count: number = await db.users.where(u => u.active.eq(true)).count();

// Numeric aggregations on a specific field
const total: number = await db.orders.where(o => o.status.eq('completed')).sum('amount');
const avg: number = await db.orders.avg('amount');
const min: number = await db.orders.min('amount');
const max: number = await db.orders.max('amount');
```

Aggregation methods compile to `SELECT COUNT(*)`, `SELECT SUM("amount")`, etc. They respect `where()` filters.

The field argument for `sum`, `avg`, `min`, `max` is typed to accept only numeric field names from the model.

`count()` does not conflict with mutation count variants because it is a terminal method (returns `Promise<number>` directly), while mutation count variants are part of a different chain.

### 6.2 GroupBy (Separate Builder)

`groupBy()` produces a **different builder type** (`GroupedCollection`) with distinct type state and available methods. It is not chainable with `findMany()`.

```typescript
const roleStats = await db.users
  .groupBy('role')
  .count();
// Type: Array<{ role: string; count: number }>

const departmentSalaries = await db.employees
  .groupBy('department')
  .avg('salary')
  .sum('salary');
// Type: Array<{ department: string; avgSalary: number; sumSalary: number }>

// GroupBy with having
const activeDepartments = await db.employees
  .groupBy('department')
  .having(g => g.count().gt(5))
  .count();

// Multi-column groupBy
const stats = await db.orders
  .groupBy('status', 'region')
  .count()
  .sum('amount');
```

The `GroupedCollection` builder exposes aggregation methods (`.count()`, `.sum()`, `.avg()`, `.min()`, `.max()`) and `.having()` for group filtering, but does **not** expose `.findMany()`, `.findFirst()`, `.select()`, or `.include()`.

### 6.3 Aggregations in Includes (Exploratory)

**Design TBD.** An interesting possibility is allowing aggregation within include refinement callbacks:

```typescript
// Instead of loading all posts, just get the count
const usersWithPostCount = await db.users
  .include('posts', p => p.count());
// Type: { ...UserFields, posts: number }

// Or combined with filtering
const usersWithPublishedCount = await db.users
  .include('posts', p => p.where(post => post.published.eq(true)).count());
```

This would require the include system to recognize when the refinement callback produces an aggregation rather than a collection, and compile accordingly (e.g., `COUNT(*)` in the lateral subquery instead of `json_agg(*)`).

This feature is marked as exploratory and requires further design work.

---

## 7. Repository and ORM Client

### 7.1 Repository Base Class

`Repository` is the entry point for accessing a model. It extends `Collection` and provides the constructor that resolves the model name to a table name.

```typescript
class Repository<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends keyof TContract['models'] & string,
> extends Collection<
  TContract,
  ModelName,
  DefaultModelRow<TContract, ModelName>
> {
  constructor(ctx: RepositoryContext<TContract>, modelName: ModelName) {
    const tableName = ctx.contract.mappings.modelToTable?.[modelName]
      ?? modelName.toLowerCase();
    super(ctx, modelName, tableName, emptyState());
  }
}
```

#### Custom Repository Subclasses

Custom repositories add domain methods by extending `Repository`. These methods return `Collection` instances via the fluent API, which means they compose naturally with all other Collection methods.

```typescript
class UserRepository extends Repository<Contract, 'User'> {
  admins() {
    return this.where(u => u.kind.eq('admin'));
  }

  byEmail(email: string) {
    return this.where(u => u.email.eq(email));
  }

  active() {
    return this.where(u => u.active.eq(true));
  }

  recentlyCreated(since: Date) {
    return this.where(u => u.createdAt.gte(since))
               .orderBy(u => u.createdAt.desc());
  }
}

// Usage:
const recentAdmins = await db.users
  .admins()
  .recentlyCreated(lastWeek)
  .take(10)
  .findMany();
```

The model name parameter (`'User'`) remains a required runtime argument (it cannot be inferred from generics). This is a deliberate choice: the model name is needed at runtime to resolve table names and field mappings from the contract.

### 7.2 ORM Client Factory

The `orm()` factory creates a typed client object that provides property-based access to repositories.

```typescript
function orm<TContract, Repos>(
  options: OrmOptions<TContract, Repos>
): OrmClient<TContract, Repos>;

interface OrmOptions<TContract, Repos> {
  readonly contract: TContract;
  readonly runtime: RuntimeQueryable;
  readonly repositories?: Repos;
}
```

The returned `OrmClient` is a `Proxy`-based object that:

1. Returns custom repositories from the `repositories` option by key.
2. Falls back to lazily-created default `Repository` instances.
3. Supports model name aliasing: `User`, `user`, and `users` all resolve to the `User` model.
4. Caches created repositories for subsequent access.

```typescript
const db = orm({
  contract,
  runtime,
  repositories: {
    users: new UserRepository({ contract, runtime }, 'User'),
    posts: new PostRepository({ contract, runtime }, 'Post'),
  },
});

// Access via aliases
db.users        // UserRepository (custom)
db.User         // UserRepository (custom, same instance as db.users)
db.posts        // PostRepository (custom)
db.comments     // Repository<Contract, 'Comment'> (default, lazily created)
db.Comment      // Repository<Contract, 'Comment'> (default, same instance)
```

#### Type Mapping

```typescript
type ModelAliasKeys<Name extends string> =
  | Name                      // 'User'
  | LowercaseFirst<Name>     // 'user'
  | `${LowercaseFirst<Name>}s`; // 'users'

type OrmClient<TContract, Repos> =
  ModelRepositoryMap<TContract> & Repos;
```

When a custom repository is provided under a key that matches a model alias, the custom repository type takes precedence, preserving the custom methods on the type.

---

## 8. Select/Include Interaction

`select()` and `include()` are **complementary, not mutually exclusive**. This is a fundamental design constraint.

### Rules

1. `select()` narrows the **current model's scalar fields** in the result type.
2. `include()` adds **relation fields** to the result type.
3. Using both composes them: the result type includes the selected scalars plus the included relations.
4. Nested `select()` within `include()` narrows fields on the related model.

### Type Narrowing

```typescript
// Full model row (default)
db.users.findMany()
// Type: Promise<{ id: number; name: string; email: string; role: string; active: boolean }[]>

// Select narrows scalars
db.users.select('name', 'email').findMany()
// Type: Promise<{ name: string; email: string }[]>

// Include adds relations
db.users.include('posts').findMany()
// Type: Promise<{ id: number; name: string; email: string; role: string; active: boolean; posts: PostRow[] }[]>

// Select + include compose
db.users.select('name', 'email').include('posts').findMany()
// Type: Promise<{ name: string; email: string; posts: PostRow[] }[]>

// Nested select within include
db.users.include('posts', p => p.select('title', 'createdAt')).findMany()
// Type: Promise<{ ...UserFields; posts: { title: string; createdAt: Date }[] }[]>

// Deep nesting
db.users
  .select('name')
  .include('posts', p =>
    p.select('title')
     .include('comments', c => c.select('body'))
  )
  .findMany()
// Type: Promise<{ name: string; posts: { title: string; comments: { body: string }[] }[] }[]>
```

### Implementation

The `Row` type parameter on `Collection` tracks the current result shape. `select()` narrows it:

```typescript
select<Fields extends (keyof FieldsOf<TContract, ModelName> & string)[]>(
  ...fields: Fields
): Collection<TContract, ModelName, Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> & IncludedRelationsOf<Row>, State>;
```

Where `IncludedRelationsOf<Row>` extracts any previously-added relation fields from the current `Row` type, preserving them through the select narrowing.

---

## 9. Out of Scope

The following items are explicitly excluded from this specification:

| Item | Rationale | Tracking |
|------|-----------|----------|
| Transactions | Separate design concern with isolation levels, retry semantics, savepoints | TML-1912 |
| Error handling taxonomy | `findUniqueOrThrow`, structured error types, constraint violation errors | TML-1911 |
| Raw SQL escape hatch | Use the DSL lane (`@prisma-next/sql-lane`) or driver directly | N/A |
| Additional comparison operators | `between`, `regex`, `jsonPath` -- conceptually similar to existing operators, add incrementally | N/A |
| Computed fields / renaming in select | `select({ fullName: u => concat(u.first, u.last) })` -- adds significant type complexity | Deferred |
| Opaque cursor tokens | Using explicit `{ field: value }` cursor instead | By design |
| M:N junction table traversal | Requires dedicated strategy design | Future ADR |
| Change tracking / identity map | Not part of Prisma Next's design philosophy | N/A |
| Caching | Application-level concern, not ORM concern | N/A |

---

## 10. Open Design Questions

### 10.1 Aggregation Detailed API

**Status:** General direction established, specific API needs exploration.

The general direction is:
- Simple aggregations (`count`, `sum`, `avg`, `min`, `max`) as terminal methods on Collection.
- `groupBy` as a separate builder type.
- Aggregations in includes as an exploratory direction.

Open questions:
- Should `sum('field')` return `Promise<number>` or `Promise<number | null>` (when no rows match)?
- How do aggregation methods interact with `select()` / `include()` (likely N/A for scalar aggregations)?
- Should `groupBy` support `.where()` on the grouped builder (applied before grouping) in addition to `.having()` (applied after)?
- What is the exact return type shape for multi-aggregation groupBy (`groupBy('role').count().sum('salary')`)?

### 10.2 Mutation Result Variant Naming

**Status:** Method-based approach confirmed; exact method names need team discussion.

Options A, B, and C are documented in section 5.3. The team needs to align on:
- Which option to adopt (recommendation: Option A).
- Exact method names for the count variant.
- Whether `create()` should always include `RETURNING` or only when the result is consumed.

### 10.3 Shorthand Filter Edge Cases

**Status:** Core behavior defined; edge cases need specification.

Defined: `{ field: value }` desugars to equality, multiple fields are AND-ed, `null` produces `isNull`.

Open:
- Should `{ field: [1, 2, 3] }` desugar to `IN`? (Leaning yes -- aligns with Prisma ORM behavior.)
- Should `{ field: undefined }` be silently ignored or throw? (Leaning: silently ignored, to support conditional filters built from optional parameters.)
- Should empty objects `{}` be allowed? (Leaning: yes, treated as no filter -- identity operation.)

---

## 11. Migration Path

The repository layer is the **successor** to the ORM lane (ADR 015). The migration follows this path:

1. **Current state:** The ORM lane (`@prisma-next/sql-orm-lane`) compiles each call to a single Plan per ADR 015. The repository layer (`@prisma-next/sql-repositories`) exists as a prototype with basic read operations.

2. **Feature parity:** The repository layer implements the full API surface described in this spec, covering all functionality currently provided by the ORM lane plus mutations, aggregations, and multi-query orchestration.

3. **Deprecation:** Once the repository layer reaches feature parity, the ORM lane is deprecated. A deprecation notice is added to `@prisma-next/sql-orm-lane` pointing users to `@prisma-next/sql-repositories`.

4. **Coexistence:** During the transition period, both packages coexist. The repository layer may internally use the ORM lane or DSL lane to build individual Plans. Existing lane-level usage continues to work unchanged.

5. **Removal:** The ORM lane is removed in a future major version after a deprecation period.

No breaking changes are introduced to existing lane usage at any point. The repository layer is a new API surface that users opt into.

---

## Appendix A: Complete API Surface Summary

### Imports

```typescript
import {
  orm,
  Repository,
  Collection,
  and,
  or,
  not,
  all,
} from '@prisma-next/sql-repositories';
```

### Collection Methods (Chainable)

| Method | Returns | Description |
|--------|---------|-------------|
| `where(fn \| expr \| object)` | `Collection` | Append filter (AND with existing) |
| `include(relation, refine?)` | `Collection` | Load related records |
| `select(...fields)` | `Collection` | Project scalar fields |
| `orderBy(fn \| array)` | `Collection` | Order results |
| `take(n)` | `Collection` | Limit result count |
| `skip(n)` | `Collection` | Offset results |
| `cursor({ field: value })` | `Collection` | Cursor-based pagination (requires orderBy) |
| `distinct(...fields)` | `Collection` | SELECT DISTINCT |
| `distinctOn(...fields)` | `Collection` | DISTINCT ON (requires orderBy) |

### Collection Methods (Terminal -- Reads)

| Method | Returns | Description |
|--------|---------|-------------|
| `findMany()` | `AsyncIterableResult<Row>` | Execute query; async iterable + thenable (awaiting resolves to `Row[]`) |
| `findFirst()` | `Promise<Row \| null>` | Execute query, return first match or null |
| `findUnique(criterion)` | `Promise<Row \| null>` | Find by unique constraint |
| `count()` | `Promise<number>` | Count matching records |
| `sum(field)` | `Promise<number>` | Sum a numeric field |
| `avg(field)` | `Promise<number>` | Average a numeric field |
| `min(field)` | `Promise<number>` | Minimum of a field |
| `max(field)` | `Promise<number>` | Maximum of a field |

### Collection Methods (Terminal -- Mutations)

| Method | Requires `where()` | Returns | Description |
|--------|-------------------|---------|-------------|
| `create(data)` | No | `Promise<Row>` | Insert one record |
| `update(data)` | Yes | `Promise<Row[]>` | Update matching records |
| `delete()` | Yes | `Promise<Row[]>` | Delete matching records |
| `upsert({ create, update })` | No | `Promise<Row>` | Insert or update |
| `createMany(data[])` | No | `Promise<number>` | Bulk insert |
| `updateMany(data)` | Yes | `Promise<number>` | Bulk update |
| `deleteMany()` | Yes | `Promise<number>` | Bulk delete |

### Standalone Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `and(...exprs)` | `AndExpr` | Combine with AND |
| `or(...exprs)` | `OrExpr` | Combine with OR |
| `not(expr)` | `WhereExpr` | Negate a filter |
| `all()` | `WhereExpr` | Match all rows (sentinel for whole-table mutations) |
| `orm(options)` | `OrmClient` | Create typed client |

### GroupedCollection Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `count()` | `GroupedCollection` (or terminal) | Add count aggregation |
| `sum(field)` | `GroupedCollection` | Add sum aggregation |
| `avg(field)` | `GroupedCollection` | Add avg aggregation |
| `min(field)` | `GroupedCollection` | Add min aggregation |
| `max(field)` | `GroupedCollection` | Add max aggregation |
| `having(predicate)` | `GroupedCollection` | Filter groups |

---

## Appendix B: Example -- Full Application Pattern

```typescript
import { orm, Repository, and, or } from '@prisma-next/sql-repositories';
import type { Contract } from './.prisma/contract';
import type { Runtime } from '@prisma-next/sql-runtime';

// --- Custom Repositories ---

class UserRepository extends Repository<Contract, 'User'> {
  admins() {
    return this.where(u => u.role.eq('admin'));
  }

  active() {
    return this.where(u => u.active.eq(true));
  }

  byEmail(email: string) {
    return this.where(u => u.email.eq(email));
  }

  withPosts() {
    return this.include('posts');
  }

  search(query: string) {
    return this.where(u =>
      or(u.name.ilike(`%${query}%`), u.email.ilike(`%${query}%`))
    );
  }
}

class PostRepository extends Repository<Contract, 'Post'> {
  published() {
    return this.where(p => p.published.eq(true));
  }

  forUser(userId: number) {
    return this.where(p => p.userId.eq(userId));
  }

  withComments() {
    return this.include('comments', c =>
      c.where(comment => comment.approved.eq(true))
       .orderBy(comment => comment.createdAt.asc())
    );
  }
}

// --- Client Setup ---

function createClient(contract: Contract, runtime: Runtime) {
  return orm({
    contract,
    runtime,
    repositories: {
      users: new UserRepository({ contract, runtime }, 'User'),
      posts: new PostRepository({ contract, runtime }, 'Post'),
    },
  });
}

// --- Usage ---

async function main(db: ReturnType<typeof createClient>) {
  // Composed read queries
  const recentAdmins = await db.users
    .admins()
    .active()
    .orderBy(u => u.createdAt.desc())
    .take(10)
    .findMany();

  // Find unique
  const alice = await db.users
    .select('name', 'email')
    .include('posts', p => p.published().take(5))
    .findUnique({ email: 'alice@example.com' });

  // Relational filter
  const usersWithPublishedPosts = await db.users
    .where(u => u.posts.some(p => p.published.eq(true)))
    .findMany();

  // Create with nested mutation
  const newUser = await db.users.create({
    name: 'Bob',
    email: 'bob@example.com',
    posts: {
      create: [{ title: 'My First Post', published: false }],
    },
  });

  // Scoped update
  await db.users
    .where(u => u.role.eq('guest'))
    .where(u => u.lastLoginAt.lt(thirtyDaysAgo))
    .update({ active: false });

  // Aggregation
  const activeCount = await db.users.active().count();

  // GroupBy
  const roleCounts = await db.users
    .groupBy('role')
    .count();

  // Cursor pagination
  const nextPage = await db.posts
    .published()
    .orderBy(p => p.id.asc())
    .cursor({ id: lastSeenId })
    .take(20)
    .findMany();
}
```

---

## Appendix C: Existing Implementation Delta

This section summarizes the changes needed from the current implementation to match this specification.

| Area | Current State | Target State |
|------|--------------|-------------|
| `FilterExpr` | Internal `{ column, op, value }` | PN AST `WhereExpr` |
| `ColumnAccessor` | Scalar comparisons only (eq, neq, gt, lt, gte, lte) | Full `ModelAccessor` with relation accessors, additional operators (like, ilike, in, notIn, isNull, isNotNull) |
| `where()` overloads | Callback only | Callback + direct AST + shorthand object |
| `findFirst()` return | `AsyncIterableResult<Row>` | `Promise<Row \| null>` |
| `findMany()` return | `AsyncIterableResult<Row>` (iterable only) | `AsyncIterableResult<Row>` (iterable + thenable, `await` resolves to `Row[]`) |
| `findUnique()` | Does not exist | Type-safe unique criterion |
| `select()` | Does not exist | Field projection with type narrowing |
| `cursor()` | Does not exist | Cursor-based pagination |
| `distinct()` / `distinctOn()` | Does not exist | Distinct selection |
| Include cardinality | Always returns `Row[]` | Cardinality-aware (`Row \| null` for 1:1/N:1, `Row[]` for 1:N) |
| Include strategy | Multi-query stitching only | Capability-based (lateral > correlated > multi-query) |
| Mutations | Do not exist | create, update, delete, upsert, batch variants |
| Nested mutations | Do not exist | Fluent chain + nested payload |
| Aggregations | Do not exist | count, sum, avg, min, max, groupBy |
| Logical combinators | Do not exist | `and()`, `or()`, `not()`, `all()` |
| `orderBy` ergonomics | Returns `{ column, direction }` object | Typed accessor with `.asc()` / `.desc()` methods |
| Type-state tracking | No type-state | Generic parameter tracking hasOrderBy, hasWhere, hasUniqueFilter |
| `CollectionState` | Stores `FilterExpr[]` | Stores `WhereExpr[]` (PN AST nodes) |
