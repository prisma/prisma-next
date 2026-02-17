# ORM Client

**Package:** `@prisma-next/sql-orm-client` (`packages/2-sql/6-orm-client/`)
**Layer:** 6 (ORM Client), Runtime Plane
**Status:** Draft
**Date:** 2026-02-16
**References:** ADR 161 (Repository Layer), ADR 015 (ORM as Optional Extension), PR #152 (AST expansion)

---

## 1. Context and Motivation

Prisma Next provides several layers for querying databases. At the lowest level, you can write raw SQL. Above that, the DSL lane (`@prisma-next/sql-lane`) gives you a type-safe SQL query builder. But most application developers don't want to think in SQL at all — they want to think in terms of their domain: **users, posts, comments**. They want to filter, include related data, paginate, create, update, and delete records using the vocabulary of their application.

That's what this spec is about: an **ORM Client** that speaks in application terms. It replaces the ORM lane (ADR 015), which was our first attempt at this but was fundamentally limited by the one-query-one-statement rule (ADR 003). The layer introduced in ADR 161 lifts that restriction — it can orchestrate multiple plans when needed (e.g. for nested mutations) while each individual plan still obeys ADR 003.

### What exists today

The `@prisma-next/sql-orm-client` package already has a working prototype on the current branch with:

- A fluent, immutable query builder with `where()`, `include()`, `orderBy()`, `take()`, `skip()`, `all()`, `find()`
- A base class for creating model-specific entry points
- An `orm()` factory that creates a typed client object (e.g. `db.users`, `db.posts`)
- Custom subclasses with domain methods (e.g. `admins()`, `forUser(userId)`)
- Multi-query include stitching with connection pinning
- Integration tests in the demo app

This spec takes that prototype, fills in the gaps (mutations, aggregations, projections, pagination, relational filters), and makes the design decisions needed for a production-quality API.

### Design Principles

1. **Application vocabulary, not database vocabulary.** The API says "model", "field", "relation" — never "table", "column", "row". Method names avoid SQL jargon: no "returning", no "rows".

2. **Streaming by default.** Results stream from the database as they arrive. The result object is both async-iterable (for streaming) and thenable (for the common `await` case). In the future we want to support real-time subscriptions on the same abstraction.

3. **Contract-derived type safety.** Every type — row shapes, field accessors, relation names, unique constraints, create inputs — is derived from the contract artifact. The contract is the single source of truth.

4. **Filters are data.** Filter expressions are plain PN AST nodes (`WhereExpr`). They can be built with the ergonomic callback API, composed with `and()`/`or()`/`not()`, or constructed externally (e.g. via the Kysely integration). The ORM client doesn't care how a filter was built.

5. **Safe by default.** `update()` and `delete()` refuse to compile without a `where()` clause. If you really want to affect every record, you write `where(all())` to make that intention explicit.

6. **Capability-driven execution.** The same API call may compile to different SQL depending on what the target supports. Lateral joins when available, correlated subqueries as a fallback, multi-query stitching as a last resort. The strategy is deterministic from the contract — no runtime feature detection.

7. **Kysely is an implementation detail.** Internally, the package uses Kysely as a query builder via `@prisma-next/integration-kysely`. That integration package handles AST conversion and SQL compilation. No Kysely type leaks into the public API, and the internal query builder is replaceable.

### Non-Goals

- Transactions (deferred to TML-1912)
- Error handling taxonomy / `findOrThrow` (deferred to TML-1911)
- Raw SQL escape hatch (use the DSL lane or driver directly)
- Computed fields or renaming within `select()`
- Opaque cursor tokens
- M:N junction table traversal strategies

---

## 2. Terminology

These terms are used throughout the spec and the codebase. Some were introduced in the prototype branch and don't exist on `main` yet.

### Collection

The central abstraction: an **immutable, fluent query builder** for a specific model. It accumulates query state — filters, includes, ordering, pagination, field selection — through method chaining. Every method (`.where()`, `.include()`, `.orderBy()`, etc.) returns a **new** Collection, leaving the original unchanged. This makes it safe to store a base query and derive multiple variants from it.

The name "Collection" was chosen because it represents a *set of model records* that you progressively refine. You start with all records of a model and narrow it down. It's the thing you interact with most — building up a query piece by piece until you call a terminal method like `all()` to execute it.

Collection is also the extension point for domain-specific query methods. Application developers subclass it to add named methods that return refined collections. These custom collections are used **everywhere** — as the top-level entry point from the ORM client, inside `include()` refinement callbacks, and anywhere else a model's collection appears. There is no separate "repository" abstraction; Collection is the single concept for querying a model.

```typescript
// A custom Collection with domain methods
class UserCollection extends Collection<Contract, 'User'> {
  admins()  { return this.where(u => u.role.eq('admin')) }
  active()  { return this.where(u => u.active.eq(true)) }
}

// Used at the top level
const users = await db.users.admins().active().all()

// Same custom methods available inside include refinements
const postsWithAdminAuthors = await db.posts
  .include('author', a => a.admins())
  .all()
```

#### Why one class, not two?

An earlier design considered splitting query building and query execution into separate classes (a "Collection" for building and a "Repository" for executing). We chose a single class for three reasons:

1. **Terminal methods are needed everywhere execution happens.** That's not just the top level — it's stored base queries (`const admins = db.users.admins(); await admins.count()`), scoped collections passed between functions, and any other context where you want to run a query. Restricting terminal methods to a "top-level" class would mean losing them in too many legitimate contexts.

2. **Include refinements are already safe.** The one place where calling a terminal method would be a mistake — inside an `include()` refinement callback — is already caught by the type system. The callback's return type expects a `Collection`, not an `AsyncIterableResult` or `Promise`. Calling `p.all()` inside `include('posts', p => ...)` is a type error without any extra machinery.

3. **Covariant `this` is simpler with one class.** If custom methods are defined on Collection and a separate Repository extends it, then `admins()` (defined on Collection) returns `Collection` — losing the terminal methods. Making the return type preserve the subclass requires `this`-type plumbing and careful clone logic. With one class, `this` always has everything.

### ORM Client

The **top-level object** returned by `orm()`. It's a proxy that provides property-based access to collections: `db.users`, `db.posts`, `db.comments`. It auto-creates default collections on first access or uses custom ones you provide.

We call it "ORM Client" because it's the user's primary handle for all data access, analogous to Prisma ORM's `PrismaClient`. The `orm()` factory name signals that this is an Object-Relational Mapping layer — the highest-level API that maps between application objects and database records.

```typescript
const db = orm({
  contract,
  runtime,
  collections: {
    users: UserCollection,
    posts: PostCollection,
  },
});

db.users.admins().all(); // UserCollection with custom method
db.comments.all();       // default Collection, auto-created
```

### ModelAccessor

The **typed proxy** you receive inside a `where()` or `orderBy()` callback. It has a property for every field and relation on the model, each with methods to build filter or ordering expressions. It replaced the earlier "ColumnAccessor" (which only had scalar fields) — the new name reflects that it also provides access to relations for relational filters (`some`, `every`, `none`).

```typescript
db.users.where(u => /* u is a ModelAccessor<Contract, 'User'> */
  and(
    u.role.eq('admin'),           // scalar field filter
    u.posts.some(p =>             // relation filter
      p.published.eq(true)
    )
  )
);
```

### CollectionState

A plain data object that holds the accumulated query state: filters, includes, ordering, limit, offset. It's what flows from the Collection API to the query compiler. It contains no query-builder types — just serializable data.

### WhereExpr

The PN AST node type for filter expressions. All filters — whether built by the callback API, standalone functions, shorthand objects, or external tools — produce `WhereExpr` nodes. This is the abstraction boundary: the ORM client builds `WhereExpr` trees, and the query builder consumes them.

---

## 3. Architecture

### 3.1 Where It Lives

The ORM client layer occupies `packages/2-sql/6-orm-client/` in the **runtime plane**, layer 6 in the package layering model. It sits above lanes (layer 4) and the SQL runtime (layer 5). Per ADR 161:

| Direction | Allowed |
|-----------|---------|
| **May import from** | Lanes (layer 4), SQL runtime (layer 5), contract, operations, `runtime-executor` |
| **Must not import** | Adapters, drivers (consumed by runtime, not by this layer) |
| **Must not be imported by** | Lower layers (lanes, runtime core, adapters, drivers) |

### 3.2 Dependencies

- `@prisma-next/contract` — `ExecutionPlan` type and contract metadata
- `@prisma-next/runtime-executor` — `AsyncIterableResult`
- `@prisma-next/sql-contract` — `SqlContract`, `SqlStorage`, `StorageColumn` types
- `@prisma-next/sql-relational-core` — `ComputeColumnJsType`, PN AST types (`WhereExpr`, etc.)
- `@prisma-next/sql-runtime` — `Runtime` type
- `@prisma-next/integration-kysely` — Kysely-based query building, AST conversion, and plan execution

### 3.3 How Queries Are Built and Executed

The ORM client layer builds Kysely queries from `CollectionState`, then delegates to `@prisma-next/integration-kysely` for everything downstream:

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

The ORM client layer does **not** perform SQL lowering or compilation — that is the integration package's job. This separation means we can replace Kysely in the future without changing the ORM client API.

### 3.4 Filter Expressions as PN AST Nodes

The prototype's internal `FilterExpr` type (`{ column, op, value }`) is replaced by the PN AST `WhereExpr` union from `@prisma-next/sql-relational-core`. This is the same type that lanes and adapters already consume, so filter expressions are portable across the entire stack.

With PR #152, `WhereExpr` expands to:

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

The ORM client layer translates `WhereExpr` nodes to Kysely `where()` calls when building queries. The integration package then converts back to the PN AST for compilation. Filters are composable, serializable, and inspectable as data.

### 3.5 Capability-Based Include Strategy

When you call `.include('posts')`, the query execution strategy depends on what the target database supports:

| Priority | Strategy | Requirements | Result |
|----------|----------|-------------|--------|
| 1 (preferred) | Lateral joins + JSON aggregation | `lateral`, `jsonAgg` capabilities | Single query |
| 2 (fallback) | Correlated subqueries + JSON aggregation | `jsonAgg` capability | Single query |
| 3 (last resort) | Multi-query stitching | None (universal) | N+1 queries, connection-pinned |

Strategy selection is **deterministic** from the contract capabilities. Per-parent `limit`/`offset` in includes moves to SQL when using lateral or correlated approaches; it's applied in-memory only for the multi-query fallback.

Currently only Postgres is supported, but the design uses capability inspection rather than hard-coded target names. The fallback path is testable by disabling capabilities in the contract.

### 3.6 Plugin Lifecycle Participation

Each `ExecutionPlan` dispatched by the ORM client passes through the `RuntimeExecutor` plugin lifecycle hooks (`beforeCompile`, `afterExecute`). Plans use `meta.lane = 'orm-client'` to distinguish themselves from direct lane usage. Operation-level telemetry aggregates individual Plan telemetry into a summary (per ADR 161 section 8).

---

## 4. Types

All types are derived from the contract type parameter. The existing type helpers (`DefaultModelRow`, `FieldsOf`, `RelationsOf`, etc.) are extended as needed.

### 4.1 Model Row Types

```typescript
/** All scalar fields of a model with their JS types. */
type DefaultModelRow<TContract, ModelName> = {
  [K in keyof FieldsOf<TContract, ModelName> & string]:
    FieldJsType<TContract, ModelName, K>;
};
```

### 4.2 Relation Cardinality

The contract stores cardinality metadata on relations. Include result types reflect this:

```typescript
// 1:1 or N:1 relations → Row | null
// 1:N or M:N relations → Row[]
type IncludeResultType<Cardinality, Row> =
  Cardinality extends '1:1' | 'N:1' ? Row | null :
  Cardinality extends '1:N' | 'M:N' ? Row[] :
  Row[];
```

This means `.include('author')` on a post returns `UserRow | null`, while `.include('posts')` on a user returns `PostRow[]`.

### 4.3 Create Input Types

For `create()`, the input type distinguishes required from optional fields based on contract metadata:

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

### 4.4 Type-State Tracking

The Collection carries generic type parameters that track query builder state for compile-time method gating:

```typescript
class Collection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState = DefaultState,
> { /* ... */ }

interface CollectionTypeState {
  hasOrderBy: boolean;
  hasWhere: boolean;
  hasUniqueFilter: boolean;
}
```

This enables the type system to enforce constraints like "you can't call `cursor()` without `orderBy()`" or "you can't call `delete()` without `where()`":

| Method | Requires |
|--------|----------|
| `cursor({ field: value })` | `hasOrderBy: true` |
| `distinctOn(...fields)` | `hasOrderBy: true` |
| `update(data)` | `hasWhere: true` |
| `delete()` | `hasWhere: true` |
| `updateMany(data)` | `hasWhere: true` |
| `deleteMany()` | `hasWhere: true` |

The internal type machinery can be as complex as needed, but user-facing types stay simple. Custom collection subclasses should not need to spell out type-state generics — they're inferred through method chaining:

```typescript
class UserCollection extends Collection<Contract, 'User'> {
  admins() {
    // Return type is inferred — no explicit generics needed
    return this.where(u => u.kind.eq('admin'));
  }
}
```

---

## 5. The Filter System

Filters are the core of query building. The design centers on one idea: **all filters produce `WhereExpr` AST nodes**, regardless of how they were built.

### 5.1 Three Ways to Write `where()`

```typescript
// 1. Callback with typed ModelAccessor (most common)
db.users.where(u => u.email.eq('alice@example.com'))

// 2. Direct AST node (for externally-built or programmatic filters)
db.users.where(someWhereExprNode)

// 3. Shorthand equality object (for the simplest case)
db.users.where({ role: 'admin' })
```

Multiple `where()` calls are combined with AND:

```typescript
db.users
  .where(u => u.role.eq('admin'))
  .where(u => u.active.eq(true))
// equivalent to: WHERE role = 'admin' AND active = true
```

#### Shorthand Object Behavior

`{ field: value }` desugars to equality comparisons ANDed together:

```typescript
db.users.where({ role: 'admin', active: true })
// equivalent to: db.users.where(u => and(u.role.eq('admin'), u.active.eq(true)))
```

- Multiple fields → AND
- `null` values → `NullCheckExpr` with `isNull: true`
- Nested objects are not supported (use the callback for relational filters)

Edge cases still being finalized (see section 10.3):
- `{ field: [1, 2, 3] }` → likely `IN` (aligns with Prisma ORM)
- `{ field: undefined }` → likely silently ignored (supports conditional filters)
- `{}` → likely identity (no filter)

### 5.2 Standalone Logical Functions

```typescript
import { and, or, not, all } from '@prisma-next/sql-orm-client';

and(...exprs: WhereExpr[]): AndExpr
or(...exprs: WhereExpr[]): OrExpr
not(expr: WhereExpr): WhereExpr
all(): WhereExpr  // sentinel: "match everything" — required for whole-table mutations
```

These are the fundamental combinators. The comparison methods on the ModelAccessor (`.eq()`, `.gt()`, etc.) delegate to these — functions are the more basic abstraction, and methods are sugar. This means users can define their own filter-building functions that compose naturally:

```typescript
function activeAdmins(u: ModelAccessor<Contract, 'User'>): WhereExpr {
  return and(u.role.eq('admin'), u.active.eq(true));
}

db.users.where(u => activeAdmins(u)).all();
```

### 5.3 The ModelAccessor

The `ModelAccessor` is a Proxy-based object you receive inside `where()` and `orderBy()` callbacks. It unifies scalar field comparisons and relation accessors on a single object.

```typescript
type ModelAccessor<TContract, ModelName> = {
  // Scalar fields → typed comparison methods
  [K in ScalarFields]: ScalarFieldAccessor<FieldJsType<...>>;
  // Relations → relational filter methods
  [K in RelationNames]: RelationFilterAccessor<...>;
};
```

#### Scalar Fields

Each scalar field property provides comparison and ordering methods:

```typescript
interface ScalarFieldAccessor<T> {
  eq(value: T): WhereExpr;
  neq(value: T): WhereExpr;
  gt(value: T): WhereExpr;
  lt(value: T): WhereExpr;
  gte(value: T): WhereExpr;
  lte(value: T): WhereExpr;
  like(pattern: string): WhereExpr;    // when T extends string
  ilike(pattern: string): WhereExpr;   // when T extends string
  in(values: T[]): WhereExpr;
  notIn(values: T[]): WhereExpr;
  isNull(): WhereExpr;                 // when field is nullable
  isNotNull(): WhereExpr;              // when field is nullable
  asc(): OrderByDirective;
  desc(): OrderByDirective;
}
```

#### Relations: `some`, `every`, `none`

Relation properties provide relational filter methods that compile to `EXISTS` / `NOT EXISTS` subqueries:

```typescript
interface RelationFilterAccessor<TContract, RelatedModelName> {
  some(predicate?):  WhereExpr;  // EXISTS (... WHERE <join> AND <predicate>)
  every(predicate):  WhereExpr;  // NOT EXISTS (... WHERE <join> AND NOT <predicate>)
  none(predicate?):  WhereExpr;  // NOT EXISTS (... WHERE <join> [AND <predicate>])
}
```

We chose `some`/`every`/`none` (matching Prisma ORM's naming) over alternatives like `has` because they read naturally as quantifiers: "users where **some** posts are published", "users where **every** post is approved", "users with **none** of their posts flagged".

Relational filters nest to arbitrary depth:

```typescript
// Users who have a post with an approved comment
db.users.where(u =>
  u.posts.some(p =>
    p.comments.some(c => c.approved.eq(true))
  )
)
```

The nested predicate accepts all three `where()` overloads (callback, AST, shorthand object).

---

## 6. Read API

### 6.1 Building Queries

All of these methods return a new Collection — they're chainable and composable.

#### `where(fn | expr | object)`

See section 5.1 above.

#### `include(relation, refine?)`

Loads related records. Return types are cardinality-aware:

```typescript
db.users.include('posts')       // { ...UserFields, posts: PostRow[] }
db.posts.include('author')      // { ...PostFields, author: UserRow | null }

// With refinement — receives the related model's Collection (with custom methods if registered)
db.users.include('posts', p =>
  p.where(post => post.published.eq(true))
   .orderBy(post => post.createdAt.desc())
   .take(5)
)

// Custom collection methods work inside include refinements
db.users.include('posts', p => p.published().recent(5))

// Nested includes
db.users.include('posts', p =>
  p.include('comments', c =>
    c.where(comment => comment.approved.eq(true))
  )
)
```

The include refinement callback receives the **registered Collection** for the related model (custom subclass if one was provided to `orm()`, otherwise a default Collection). This means domain methods defined on a custom collection are available everywhere that model's collection appears — at the top level and inside include refinements alike.

The include strategy (lateral joins, correlated subqueries, or multi-query) is selected from contract capabilities as described in section 3.5.

#### `select(...fields)`

Projects specific scalar fields on the current model, narrowing the result type:

```typescript
db.users.select('name', 'email')
// Result: { name: string; email: string }
```

`select()` and `include()` are **complementary, not mutually exclusive**:

```typescript
db.users.select('name', 'email').include('posts')
// Result: { name: string; email: string; posts: PostRow[] }
```

To narrow fields on a related model, use the include refinement callback:

```typescript
db.users.include('posts', p => p.select('title', 'createdAt'))
// Result: { ...UserFields, posts: { title: string; createdAt: Date }[] }
```

Calling `select()` multiple times replaces the previous selection (last call wins).

#### `orderBy(fn | array)`

Orders results using typed field accessors:

```typescript
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

#### `take(n)` / `skip(n)`

Offset-based pagination:

```typescript
db.users.orderBy(u => u.createdAt.desc()).skip(20).take(10)
```

#### `cursor({ field: value })`

Cursor-based pagination using explicit field+value pairs. Requires `orderBy` (enforced at the type level):

```typescript
db.users
  .orderBy(u => u.id.asc())
  .cursor({ id: 42 })
  .take(10)
// Returns 10 users with id > 42

// Without orderBy — type error:
db.users.cursor({ id: 42 })
//       ^^^^^^ Error: cursor() requires orderBy
```

For compound cursors (multi-column orderBy), the compiler generates the appropriate tuple comparison.

#### `distinct(...fields)` / `distinctOn(...fields)`

```typescript
db.users.distinct('role')                            // SELECT DISTINCT
db.users.orderBy(u => u.createdAt.desc()).distinctOn('email')  // DISTINCT ON (Postgres)
```

`distinctOn` requires `orderBy` (type-state gated) because `DISTINCT ON` semantics depend on ordering.

### 6.2 Executing Queries

These are **terminal methods** — they execute the query.

#### `all()`

```typescript
// Streaming (async iterable)
for await (const user of db.users.where(u => u.active.eq(true)).all()) {
  console.log(user);
}

// Collect into array (thenable shorthand)
const users: UserRow[] = await db.users
  .where(u => u.active.eq(true))
  .all();
```

Returns `AsyncIterableResult<Row>`, which implements both the async iterable protocol (`for await...of`) and the thenable protocol (`await` resolves to `Row[]`). Streaming is a first-class capability; the thenable shorthand eliminates `.toArray()` boilerplate for the common case.

#### Eager execution, lazy consumption

Unlike Prisma ORM's `PrismaPromise`, which defers the database request until `.then()` is called, the Prisma Next ORM client sends the query to the database **eagerly** when a terminal method is called. The `AsyncIterableResult` returned by `all()` represents an in-flight query whose response has not yet been read — not a deferred query that hasn't been sent.

```typescript
const result = db.users.all();  // query is sent to the database NOW
// ...do other work...
for await (const user of result) { /* rows are read lazily */ }
```

This distinction matters for two reasons:

1. **Predictable timing.** The query executes when you call `all()`, not when you happen to consume the result. There are no hidden side effects inside `.then()` or `Symbol.asyncIterator`.

2. **Compatibility with effect systems.** Libraries like Effect's `tryPromise` expect to receive a function that initiates work. With eager execution, the terminal method is that function — the returned thenable is a straightforward value, not a lazy thunk that re-executes on each `.then()` call.

#### `find()`

Returns the first matching record or `null`. Compiles to `LIMIT 1`.

```typescript
const user: UserRow | null = await db.users
  .where({ email: 'alice@example.com' })
  .find();

const user = await db.users
  .select('name', 'email')
  .include('posts')
  .where({ id: 42 })
  .find();
// Type: { name: string; email: string; posts: PostRow[] } | null
```

There is no separate `findUnique` method. Unique lookups use the same `where()` + `find()` pattern — the database optimizer will use the unique index regardless. This keeps the API surface minimal: `where()` is the single way to specify criteria, `find()` is the single way to get one record.

### 6.3 Include Execution Strategies

**Strategy 1: Lateral Joins + JSON Aggregation** (single query, preferred)

```sql
SELECT u.*, (
  SELECT json_agg(sub.*)
  FROM LATERAL (
    SELECT p.* FROM posts p
    WHERE p.user_id = u.id
    ORDER BY p.created_at DESC LIMIT 5
  ) sub
) AS "posts"
FROM users u WHERE u.active = true
```

**Strategy 2: Correlated Subqueries + JSON Aggregation** (single query, fallback)

Same shape but without `LATERAL` — the subquery references the outer table directly.

**Strategy 3: Multi-Query Stitching** (last resort)

1. Execute parent query.
2. Collect parent primary key values.
3. For each include: `SELECT * FROM <related> WHERE <fk> IN ($parentPks)`.
4. Group child rows by FK and stitch onto parents.
5. Apply per-parent `limit`/`offset` in memory.

### 6.4 Relational Filters

```typescript
db.users.where(u => u.posts.some(p => p.published.eq(true)))   // has published post
db.users.where(u => u.posts.every(p => p.published.eq(true)))  // all posts published
db.users.where(u => u.posts.none())                            // has no posts
db.users.where(u => u.posts.none(p => p.published.eq(true)))   // no published posts
```

Compilation:
- `some(pred)` → `EXISTS (SELECT 1 FROM <related> WHERE <join> AND <pred>)`
- `every(pred)` → `NOT EXISTS (SELECT 1 FROM <related> WHERE <join> AND NOT (<pred>))`
- `none(pred?)` → `NOT EXISTS (SELECT 1 FROM <related> WHERE <join> [AND <pred>])`

---

## 7. Mutation API

### 7.1 Single-Record Mutations

#### `create(data)`

Inserts a new record. The data type distinguishes required from optional fields (see section 4.4).

```typescript
const user = await db.users.create({
  email: 'alice@example.com',  // required
  name: 'Alice',               // required
  // id: auto-generated, optional
  // createdAt: has default, optional
});
```

Compiles to `INSERT ... RETURNING *` when the target supports `RETURNING`. When unavailable, the ORM client orchestrates `INSERT` followed by `SELECT` using the known key (per ADR 161 section 5).

#### `update(data)`

Updates records matching the current `where()` filters. **Requires at least one `where()` filter** (type-state gated).

```typescript
await db.users
  .where(u => u.id.eq(42))
  .update({ name: 'Alice Updated' });

// Type error — no where():
await db.users.update({ name: 'oops' });

// Whole-table update requires explicit intent:
await db.users.where(all()).update({ active: false });
```

#### `delete()`

Deletes records matching the current `where()` filters. Same safety guardrail as `update()`.

```typescript
await db.users.where(u => u.id.eq(42)).delete();
await db.users.where(all()).delete();  // whole-table
```

#### `upsert({ create, update })`

Insert or update on conflict. Compiles to `INSERT ... ON CONFLICT DO UPDATE`.

```typescript
const user = await db.users.upsert({
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice Updated' },
});

// When multiple unique constraints exist, specify which one:
const user = await db.users.upsert({
  conflictOn: 'email',
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice Updated' },
});
```

### 7.2 Batch Operations

```typescript
// Bulk insert — returns count
const count = await db.users.createMany([
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
]);

// Bulk update — requires where(), returns count
const count = await db.users
  .where(u => u.role.eq('guest'))
  .updateMany({ active: false });

// Bulk delete — requires where(), returns count
const count = await db.users
  .where(u => u.active.eq(false))
  .deleteMany();
```

### 7.3 Mutation Result Variants

Some mutations need to return the affected record(s), others just a count. The API must distinguish these without SQL jargon like "returning" or "rows".

The confirmed direction is a **method-based approach** to avoid method-name explosion. We document three options for team discussion:

**Option A: Default record return, chain for count** (recommended to explore)

```typescript
const user = await db.users.create({ ... });                    // returns record
const count = await db.users.where(...).delete().count();       // returns count
```

**Option B: Separate named methods**

```typescript
const user = await db.users.create({ ... });                    // returns record
const count = await db.users.where(...).deleteCount();          // returns count
```

**Option C: Execution modifier**

```typescript
const user = await db.users.create({ ... }).get();              // returns record
const count = await db.users.where(...).delete().exec();        // returns count
```

`select()` and `include()` compose with mutations to control what data comes back:

```typescript
const result = await db.users.create({ ... }).select('id', 'email');
const result = await db.users.create({ ... }).include('posts');
```

### 7.4 Nested Mutations

Relation fields in `create()` and `update()` payloads use **callbacks** that receive a typed `RelationMutator` for the related model. This is consistent with the rest of the API: just as `where()` and `include()` use callbacks with typed accessors, nested mutations use callbacks with typed mutators.

#### Basic nested create

```typescript
const user = await db.users.create({
  name: 'Alice',
  email: 'alice@example.com',
  posts: p => p.create([
    { title: 'First Post' },
    { title: 'Second Post' },
  ]),
});
```

The callback `p => p.create([...])` receives a `RelationMutator<Contract, 'Post'>` and returns a `RelationMutation` — an opaque instruction describing what to do. Scalar fields are plain values; relation fields are callbacks.

#### Connecting existing records

```typescript
const post = await db.posts.create({
  title: 'New Post',
  author: a => a.connect({ id: authorId }),
});
```

`connect()` takes a unique criterion identifying the record to link. For to-many relations, it accepts an array:

```typescript
const post = await db.posts.create({
  title: 'Tagged Post',
  tags: t => t.connect([{ id: tag1Id }, { id: tag2Id }]),
});
```

#### Deep nesting

The data argument to `create()` on a relation mutator is itself a `CreateInput` for the related model — so relation fields at any depth use the same callback pattern:

```typescript
const org = await db.organizations.create({
  name: 'Acme Corp',
  plan: 'enterprise',
  owner: o => o.connect({ id: founderId }),
  departments: d => d.create([
    {
      name: 'Engineering',
      teams: t => t.create([
        {
          name: 'Platform',
          members: m => m.create([
            { role: 'lead', user: u => u.connect({ email: 'alice@acme.com' }) },
            { role: 'member', user: u => u.connect({ email: 'bob@acme.com' }) },
          ]),
        },
        {
          name: 'Product',
          members: m => m.create([
            { role: 'lead', user: u => u.connect({ email: 'charlie@acme.com' }) },
          ]),
        },
      ]),
    },
    {
      name: 'Marketing',
      teams: t => t.create([
        {
          name: 'Growth',
          members: m => m.create([
            { role: 'lead', user: u => u.connect({ email: 'diana@acme.com' }) },
          ]),
        },
      ]),
    },
  ]),
});
```

Compare with the Prisma ORM equivalent of the same operation, which uses `{ create: [...] }` / `{ connect: {...} }` objects at each level. The callback style provides IDE autocompletion on the mutator methods and makes the operation name (create vs connect) a method call rather than a key buried in nested braces.

#### RelationMutator methods

| Method | Available in | Cardinality | Description |
|--------|-------------|-------------|-------------|
| `create(data)` | create, update | to-one | Create a new related record |
| `create(data[])` | create, update | to-many | Create new related records |
| `connect(criterion)` | create, update | to-one | Link to an existing record by unique fields |
| `connect(criterion[])` | create, update | to-many | Link to existing records by unique fields |
| `disconnect()` | update | to-one (nullable FK) | Unlink the related record (set FK to null) |
| `disconnect(criterion[])` | update | to-many | Unlink specific related records |

The `criterion` argument to `connect()` and `disconnect()` is an object identifying a record by its unique constraint fields (primary key or unique index), similar to Prisma ORM's `connect` syntax.

#### Execution semantics

Nested mutations execute within a **transaction** by default (per ADR 161 section 6). The ORM client orchestrates multiple INSERT/UPDATE statements with propagated generated keys — a parent's auto-generated `id` is captured and used as the FK value in child inserts.

---

## 8. Aggregations

### 8.1 Simple Aggregations

Aggregation methods are terminal methods on Collection that return scalar values:

```typescript
const count = await db.users.where(u => u.active.eq(true)).count();
const total = await db.orders.where(o => o.status.eq('completed')).sum('amount');
const avg   = await db.orders.avg('amount');
const min   = await db.orders.min('amount');
const max   = await db.orders.max('amount');
```

Field arguments for `sum`, `avg`, `min`, `max` are typed to accept only numeric fields.

### 8.2 GroupBy

`groupBy()` produces a **different builder type** (`GroupedCollection`) with distinct type state. It is not chainable with `all()`.

```typescript
const roleStats = await db.users
  .groupBy('role')
  .count();
// Type: Array<{ role: string; count: number }>

const deptSalaries = await db.employees
  .groupBy('department')
  .avg('salary')
  .sum('salary');
// Type: Array<{ department: string; avgSalary: number; sumSalary: number }>

// With having
const activeDepts = await db.employees
  .groupBy('department')
  .having(g => g.count().gt(5))
  .count();

// Multi-column
const stats = await db.orders
  .groupBy('status', 'region')
  .count()
  .sum('amount');
```

### 8.3 Aggregations in Includes (Exploratory)

**Design TBD.** An interesting possibility:

```typescript
const usersWithPostCount = await db.users
  .include('posts', p => p.count());
// Type: { ...UserFields, posts: number }
```

This requires the include system to recognize aggregation vs collection refinement and compile accordingly (e.g. `COUNT(*)` in the lateral subquery instead of `json_agg(*)`). Marked as exploratory.

---

## 9. ORM Client

### 9.1 The `orm()` Factory

```typescript
const db = orm({
  contract,
  runtime,
  collections: {
    users: UserCollection,
    posts: PostCollection,
  },
});
```

The returned client is a `Proxy` that:

1. Returns instances of custom collection classes from the `collections` option by key.
2. Falls back to lazily-created default `Collection` instances.
3. Supports model name aliasing: `User`, `user`, and `users` all resolve to `User`.
4. Caches created collections for subsequent access.
5. Propagates the collection registry so that `include()` refinement callbacks receive the correct custom collection for each related model.

```typescript
db.users     // UserCollection (custom)
db.User      // UserCollection (same instance)
db.comments  // Collection<Contract, 'Comment'> (default, lazily created)
db.Comment   // same instance as db.comments
```

### 9.2 Custom Collections

Application developers subclass `Collection` to add domain-specific query methods:

```typescript
class UserCollection extends Collection<Contract, 'User'> {
  admins() {
    return this.where(u => u.role.eq('admin'));
  }

  byEmail(email: string) {
    return this.where(u => u.email.eq(email));
  }

  recentlyCreated(since: Date) {
    return this.where(u => u.createdAt.gte(since))
               .orderBy(u => u.createdAt.desc());
  }
}

// These compose naturally:
const recentAdmins = await db.users
  .admins()
  .recentlyCreated(lastWeek)
  .take(10)
  .all();
```

Custom collections are the **primary extension mechanism** for the ORM client. Because every method returns a new Collection (immutability), custom methods compose with all built-in methods and with each other. And because the ORM client propagates the collection registry, custom methods are available everywhere the model appears — including inside `include()` refinement callbacks:

```typescript
db.users.include('posts', p => p.published().recent(5))
```

### 9.3 Collection Registry Propagation

When the ORM client creates a Collection (either custom or default), it attaches a **collection registry** — a mapping from model name to collection class. Every chaining method (`where()`, `include()`, `orderBy()`, etc.) preserves this registry on the new Collection it returns.

When `include(relation, refine)` is called, it looks up the related model's collection class in the registry and passes an instance of it to the refinement callback. If no custom class is registered for that model, a default Collection is used.

This is an internal mechanism. Users don't interact with the registry directly — they just pass collection classes to `orm()` and everything composes.

---

## 10. Out of Scope

| Item | Rationale | Tracking |
|------|-----------|----------|
| Transactions | Separate design concern: isolation levels, retry semantics, savepoints | TML-1912 |
| Error handling taxonomy | `findOrThrow`, structured errors, constraint violations | TML-1911 |
| Raw SQL escape hatch | Use the DSL lane or driver directly | N/A |
| Additional comparison operators | `between`, `regex`, `jsonPath` — add incrementally, same pattern | N/A |
| Computed fields / renaming in select | Significant type complexity, defer | Deferred |
| Opaque cursor tokens | Using explicit `{ field: value }` by design | By design |
| M:N junction table traversal | Needs dedicated strategy design | Future ADR |
| Change tracking / identity map | Not part of PN's design philosophy | N/A |

---

## 11. Open Design Questions

### 11.1 Aggregation Detailed API

**Status:** General direction established, specific signatures need exploration.

Open:
- Should `sum('field')` return `Promise<number>` or `Promise<number | null>` (when no rows match)?
- Should `groupBy` support `.where()` on the grouped builder (before grouping) in addition to `.having()` (after)?
- What is the exact return type shape for multi-aggregation groupBy?

### 11.2 Mutation Result Variant Naming

**Status:** Method-based approach confirmed; exact names need team discussion.

Options A, B, C documented in section 7.3. The team needs to align on:
- Which option to adopt
- Exact method names for the count variant
- Whether `create()` should always include `RETURNING` or only when the result is consumed

### 11.3 Shorthand Filter Edge Cases

**Status:** Core behavior defined; edge cases need specification.

Defined: `{ field: value }` → equality, multiple fields → AND, `null` → `isNull`.

Open:
- `{ field: [1, 2, 3] }` → `IN`? (Leaning yes — aligns with Prisma ORM.)
- `{ field: undefined }` → silently ignored? (Leaning yes — supports conditional filters.)
- `{}` → identity / no filter? (Leaning yes.)

---

## 12. Migration Path

The ORM client layer succeeds the ORM lane (ADR 015):

1. **Now:** The ORM lane compiles each call to a single Plan per ADR 015. The ORM client prototype exists with basic reads.
2. **Feature parity:** This spec is implemented, covering everything the ORM lane does plus mutations, aggregations, and multi-query orchestration.
3. **Deprecation:** ORM lane gets a deprecation notice pointing to `@prisma-next/sql-orm-client`.
4. **Coexistence:** Both packages coexist during transition. Existing lane usage is unchanged.
5. **Removal:** ORM lane removed in a future major version.

No breaking changes to existing code at any point.

---

## Appendix A: Complete API Surface

### Imports

```typescript
import {
  orm,
  Collection,
  and, or, not, all,
} from '@prisma-next/sql-orm-client';
```

### Chainable Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `where(fn \| expr \| object)` | `Collection` | Append filter (AND with existing) |
| `include(relation, refine?)` | `Collection` | Load related records |
| `select(...fields)` | `Collection` | Project scalar fields |
| `orderBy(fn \| array)` | `Collection` | Order results |
| `take(n)` | `Collection` | Limit result count |
| `skip(n)` | `Collection` | Offset results |
| `cursor({ field: value })` | `Collection` | Cursor pagination (requires orderBy) |
| `distinct(...fields)` | `Collection` | SELECT DISTINCT |
| `distinctOn(...fields)` | `Collection` | DISTINCT ON (requires orderBy) |

### Terminal Methods — Reads

| Method | Returns | Description |
|--------|---------|-------------|
| `all()` | `AsyncIterableResult<Row>` | All matches; async iterable + thenable (`await` → `Row[]`) |
| `find()` | `Promise<Row \| null>` | First match or null (LIMIT 1) |
| `count()` | `Promise<number>` | Count matching records |
| `sum(field)` | `Promise<number>` | Sum a numeric field |
| `avg(field)` | `Promise<number>` | Average a numeric field |
| `min(field)` | `Promise<number>` | Minimum of a field |
| `max(field)` | `Promise<number>` | Maximum of a field |

### Terminal Methods — Mutations

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
| `all()` | `WhereExpr` | Match all records (sentinel for whole-table mutations) |
| `orm(options)` | `OrmClient` | Create typed client |

---

## Appendix B: Full Example

```typescript
import { orm, Collection, and, or } from '@prisma-next/sql-orm-client';
import type { Contract } from './.prisma/contract';

// --- Custom Collections ---

class UserCollection extends Collection<Contract, 'User'> {
  admins()  { return this.where(u => u.role.eq('admin')); }
  active()  { return this.where(u => u.active.eq(true)); }
  byEmail(email: string) { return this.where(u => u.email.eq(email)); }
  withPosts() { return this.include('posts'); }
  search(query: string) {
    return this.where(u => or(u.name.ilike(`%${query}%`), u.email.ilike(`%${query}%`)));
  }
}

class PostCollection extends Collection<Contract, 'Post'> {
  published() { return this.where(p => p.published.eq(true)); }
  forUser(userId: number) { return this.where(p => p.userId.eq(userId)); }
  recent(n: number) {
    return this.orderBy(p => p.createdAt.desc()).take(n);
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
    collections: {
      users: UserCollection,
      posts: PostCollection,
    },
  });
}

// --- Usage ---

async function main(db: ReturnType<typeof createClient>) {
  // Composed reads with custom collection methods
  const recentAdmins = await db.users
    .admins().active()
    .orderBy(u => u.createdAt.desc())
    .take(10)
    .all();

  // Find one with projections
  const alice = await db.users
    .select('name', 'email')
    .include('posts', p => p.published().take(5))
    .where({ email: 'alice@example.com' })
    .find();

  // Relational filter
  const usersWithPublishedPosts = await db.users
    .where(u => u.posts.some(p => p.published.eq(true)))
    .all();

  // Custom collection methods work inside include refinements
  const usersWithRecentPosts = await db.users
    .include('posts', p => p.published().recent(3))
    .all();

  // Create with nested mutation
  const newUser = await db.users.create({
    name: 'Bob',
    email: 'bob@example.com',
    posts: p => p.create([{ title: 'My First Post', published: false }]),
  });

  // Scoped update
  await db.users
    .where(u => u.role.eq('guest'))
    .where(u => u.lastLoginAt.lt(thirtyDaysAgo))
    .update({ active: false });

  // Aggregation + GroupBy
  const activeCount = await db.users.active().count();
  const roleCounts = await db.users.groupBy('role').count();

  // Cursor pagination
  const nextPage = await db.posts
    .published()
    .orderBy(p => p.id.asc())
    .cursor({ id: lastSeenId })
    .take(20)
    .all();
}
```

---

## Appendix C: Implementation Delta

Changes needed from the current prototype to match this specification:

| Area | Current State | Target State |
|------|--------------|-------------|
| Package name | `@prisma-next/sql-repositories` | `@prisma-next/sql-orm-client` |
| `Repository` class | Separate subclass of Collection | Removed; users extend `Collection` directly |
| `FilterExpr` | Internal `{ column, op, value }` | PN AST `WhereExpr` |
| `ColumnAccessor` | Scalar comparisons only (eq, neq, gt, lt, gte, lte) | Full `ModelAccessor` with relation accessors and additional operators |
| `where()` overloads | Callback only | Callback + direct AST + shorthand object |
| `findFirst()` → `find()` | `AsyncIterableResult<Row>` | `Promise<Row \| null>` |
| `findMany()` → `all()` | `AsyncIterableResult<Row>` (iterable only) | `AsyncIterableResult<Row>` (iterable + thenable) |
| `findUnique()` | Does not exist | Removed; use `where()` + `find()` |
| `select()` | Does not exist | Field projection with type narrowing |
| `cursor()` | Does not exist | Cursor-based pagination |
| `distinct()` / `distinctOn()` | Does not exist | Distinct selection |
| Include cardinality | Always `Row[]` | Cardinality-aware (`Row \| null` for 1:1, `Row[]` for 1:N) |
| Include strategy | Multi-query stitching only | Capability-based (lateral > correlated > multi-query) |
| Include refinement | Bare Collection | Registered Collection (with custom methods) |
| `orm()` option key | `repositories` (instances) | `collections` (classes) |
| Mutations | Do not exist | create, update, delete, upsert + batch variants |
| Nested mutations | Do not exist | Nested payload style |
| Aggregations | Do not exist | count, sum, avg, min, max, groupBy |
| Logical combinators | Do not exist | `and()`, `or()`, `not()`, `all()` |
| `orderBy` ergonomics | Returns `{ column, direction }` | Typed accessor with `.asc()` / `.desc()` |
| Type-state tracking | None | Generic parameter tracking hasOrderBy, hasWhere |
| `CollectionState` filters | `FilterExpr[]` | `WhereExpr[]` (PN AST nodes) |
| Collection registry | Does not exist | Propagated through all chaining methods for include refinements |
