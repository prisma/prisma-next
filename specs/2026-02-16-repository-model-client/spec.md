# ORM Client

**Package:** `@prisma-next/sql-orm-client` (`packages/3-extensions/sql-orm-client/`)
**Layer:** Extensions Domain, Integrations Layer, Runtime Plane
**Status:** Draft
**Date:** 2026-02-16
**References:** ADR 161 (Repository Layer), ADR 015 (ORM as Optional Extension), PR #152 (AST expansion)

---

## 1. Context and Motivation

Prisma Next provides several layers for querying databases. At the lowest level, you can write raw SQL. Above that, the DSL lane (`@prisma-next/sql-lane`) gives you a type-safe SQL query builder. But most application developers don't want to think in SQL at all — they want to think in terms of their domain: **users, posts, comments**. They want to filter, include related data, paginate, create, update, and delete records using the vocabulary of their application.

That's what this spec is about: an **ORM Client** that speaks in application terms. It replaces the ORM lane (ADR 015), which was our first attempt at this but was fundamentally limited by the one-query-one-statement rule (ADR 003). The layer introduced in ADR 161 lifts that restriction — it can orchestrate multiple plans when needed (e.g. for nested mutations) while each individual plan still obeys ADR 003.

See also [Prisma ORM Comparison](./prisma-orm-comparison.md) for context and code snippets.

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

4. **Filters are data.** Filter expressions are plain PN AST nodes (`WhereExpr`). They can be built with the ergonomic callback API, composed with `and()`/`or()`/`not()`, or constructed externally (e.g. via the Kysely integration). `where()` and `find()` consume them via callback overloads (not raw `WhereExpr` arguments), which avoids ambiguity with shorthand object filters.

5. **Safe by default.** `update()` and `delete()` refuse to compile without a `where()` clause. If you really want to affect every record, you write `where(all)` to make that intention explicit.

6. **Capability-driven execution.** The same API call may compile to different SQL depending on what the target supports. Lateral joins when available, correlated subqueries as a fallback, multi-query stitching as a last resort. The strategy is deterministic from the contract — no runtime feature detection.

7. **Kysely is an implementation detail.** Internally, the package uses Kysely for query composition and SQL compilation. `@prisma-next/integration-kysely` is the permanent execution boundary for `CompiledQuery -> ExecutionPlan` conversion and compiled-query dispatch. No Kysely type leaks into the public API, and the internal query builder is replaceable.

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

1. **Terminal methods are needed everywhere execution happens.** That's not just the top level — it's stored base queries (`const admins = db.users.admins(); await admins.aggregate(a => ({ count: a.count() }))`), scoped collections passed between functions, and any other context where you want to run a query. Restricting terminal methods to a "top-level" class would mean losing them in too many legitimate contexts.

2. **Include refinements are already safe.** The one place where executing would be a mistake — inside an `include()` refinement callback — is prevented by the type system. The callback receives a restricted collection that has no query-executing terminals (`all()`, `find()`, mutations). It can only return query fragments (`where`, `orderBy`, `take`, nested `include`, `combine`, and to-many aggregation selectors), which the parent query compiles.

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

The ORM client package occupies `packages/3-extensions/sql-orm-client/` in the **runtime plane** (`extensions` domain, `integrations` layer). It sits above lanes and SQL runtime while preserving repository-level orchestration boundaries from ADR 161:

| Direction | Allowed |
|-----------|---------|
| **May import from** | Lanes, SQL runtime, contract, operations, `runtime-executor`, integration boundaries |
| **Must not import** | Adapters, drivers (consumed by runtime, not by this layer) |
| **Must not be imported by** | Lower layers (lanes, runtime core, adapters, drivers) |

### 3.2 Dependencies

- `@prisma-next/contract` — `ExecutionPlan` type and contract metadata
- `@prisma-next/runtime-executor` — `AsyncIterableResult`
- `@prisma-next/sql-contract` — `SqlContract`, `SqlStorage`, `StorageColumn` types
- `@prisma-next/sql-relational-core` — `ComputeColumnJsType`, PN AST types (`WhereExpr`, etc.)
- `@prisma-next/sql-runtime` — `Runtime` type
- `@prisma-next/integration-kysely` — `CompiledQuery -> ExecutionPlan` conversion and compiled-query dispatch helpers

### 3.3 How Queries Are Built and Executed

The ORM client layer builds Kysely queries from `CollectionState` and compiles SQL internally, then delegates compiled-query execution to `@prisma-next/integration-kysely`:

```
CollectionState (internal)
    |
    v
Kysely query builder + SQL compilation (internal)
    |
    v
CompiledQuery --> @prisma-next/integration-kysely (execution boundary)
                     |
                     v
                 ExecutionPlan --> RuntimeQueryable.execute(plan)
```

The ORM client layer performs query composition and SQL compilation. `@prisma-next/integration-kysely` owns execution-plan conversion and dispatch. This boundary is intentional and permanent.

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

The ORM client layer translates `WhereExpr` nodes to Kysely `where()` calls when building queries. Filters are composable, serializable, and inspectable as data.

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

### 4.3 Unique Criterion Types

Even without a dedicated `findUnique()` API, unique criteria are still first-class types in this layer. They are used by relation `connect()` / `disconnect()` and `upsert({ conflictOn })`.

```typescript
type UniqueConstraintCriterion<TContract, ModelName> =
  /* union of object shapes derived from the model primary key and unique indexes */;

// Example:
type UserUniqueCriterion =
  | { id: number }
  | { email: string }
  | { tenantId: string; slug: string };
```

This type is derived from `TContract['storage']['tables'][TableName]`.

### 4.4 Create Input Types

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

### 4.5 Type-State Tracking

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
| `update(data)` / `updateAll(data)` / `updateCount(data)` | `hasWhere: true` |
| `delete()` / `deleteAll()` / `deleteCount()` | `hasWhere: true` |

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

### 5.1 Two Overloads for `where()`

```typescript
// 1. Shorthand equality object (same shape as Prisma ORM's simple where)
db.users.where({ role: 'admin' })

// 2. Callback with typed ModelAccessor (returns WhereExpr)
db.users.where(u => u.email.eq('alice@example.com'))
db.users.where(u => and(u.role.eq('admin'), u.active.eq(true)))
```

All built-in filter methods/functions (`.eq()`, `.gt()`, `and()`, `or()`, `not()`, `all()`, etc.) return `WhereExpr` and are used through the callback-style overload.

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

Additional behaviors still being finalized (see section 11.4):
- `{ field: [1, 2, 3] }` → equality against a scalar list value (not `IN`; use the callback for `IN`)
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

The nested predicate accepts the same two filter overload styles used by `where()` (callback returning `WhereExpr`, or shorthand object).

---

## 6. Read API

### 6.1 Building Queries

All of these methods return a new Collection — they're chainable and composable.

#### `where(filters | callback)`

See section 5.1 above.

#### `include(relation, refine?)`

Loads related records. Return types are cardinality-aware:

```typescript
db.users.include('posts')       // { ...UserFields, posts: PostRow[] }
db.posts.include('author')      // { ...PostFields, author: UserRow | null }

// With refinement — receives the related model's include collection (with custom methods if registered).
// It does not execute queries — it has no `all()` / `find()` / mutation terminals.
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

The include refinement callback receives an instance of the **registered collection class** for the related model (custom subclass if one was provided to `orm()`, otherwise a default Collection), but with the include-only surface (no query execution terminals). This means domain methods defined on a custom collection are available everywhere that model's collection appears — at the top level and inside include refinements alike.

For to-many includes, refinements may also return scalar aggregations (e.g. `count()`) or a `combine()` shape to return multiple named branches for a single relation (rows and/or aggregations). See section 8.3.

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

Type-level behavior: the `Row` generic tracks the current result shape. `select()` narrows scalar fields on the current model while preserving already-included relation fields.

```typescript
select<Fields extends (keyof FieldsOf<TContract, ModelName> & string)[]>(
  ...fields: Fields
): Collection<
  TContract,
  ModelName,
  Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> & IncludedRelationsOf<Row>,
  State
>;
```

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

`find()` supports three call forms:

- `find()` — no additional filter
- `find(filters: SimpleFilters)` — shorthand equality object
- `find(callback: (c: ModelAccessor<...>) => WhereExpr)` — callback filter

The filter overloads match `where()`. Raw `WhereExpr` is not accepted directly as an argument. When a filter is provided, it is ANDed with any existing `where()` filters on the collection:

```typescript
// Inline filter (most common for unique lookups)
const user = await db.users.find({ id: 42 });
const user = await db.users.find({ email: 'alice@example.com' });

// Callback filter
const activeAlice = await db.users.find(u =>
  and(u.active.eq(true), u.email.eq('alice@example.com'))
);

// Composes with prior where() — filters are ANDed
const activeAlice = await db.users
  .where(u => u.active.eq(true))
  .find({ email: 'alice@example.com' });

// No argument — first match from accumulated filters
const firstAdmin = await db.users
  .where(u => u.role.eq('admin'))
  .find();

// Composes with select() and include()
const user = await db.users
  .select('name', 'email')
  .include('posts')
  .find({ id: 42 });
// Type: { name: string; email: string; posts: PostRow[] } | null
```

There is no separate `findUnique` method. The database optimizer will use a unique index when the filter matches one, regardless of whether the API knows about it.

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

Every mutation operation has three variants that mirror the read terminals:

| Variant | Suffix | Returns | Analogous read |
|---------|--------|---------|---------------|
| **Single** | (base name) | `Promise<Row>` or `Promise<Row \| null>` | `find()` |
| **Multi** | `*All` | `AsyncIterableResult<Row>` | `all()` |
| **Count** | `*Count` | `Promise<number>` | `aggregate()` |

The single variant applies LIMIT 1 (for update/delete), just as `find()` does for reads. The multi variant streams results back, just as `all()` does. The count variant returns only the number of affected rows.

### 7.1 Create

```typescript
// create — insert one record, return it
const user = await db.users.create({
  email: 'alice@example.com',  // required
  name: 'Alice',               // required
  // id: auto-generated, optional
  // createdAt: has default, optional
});
// → Promise<Row>

// createAll — insert multiple records, return them (streamable)
const users = await db.users.createAll([
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
]);
// → AsyncIterableResult<Row>

// createCount — insert multiple records, return count
const count = await db.users.createCount([
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
]);
// → Promise<number>
```

All mutation variants that return rows (`create`, `createAll`, `update`, `updateAll`, `delete`, `deleteAll`, `upsert`) **require the `returning` capability** in the contract. On targets without `RETURNING` (e.g. MySQL), only the `*Count` variants are available. This is a deliberate choice: the ORM client does not assume the presence of primary keys or attempt multi-step fallbacks (SELECT-then-mutate), which would be fragile for views, keyless tables, and concurrent workloads.

`createCount`, `updateCount`, and `deleteCount` work on all targets.

### 7.1.1 `select()` / `include()` with Mutations

`select()` and `include()` apply to row-returning mutation variants when configured on the collection before the terminal mutation call.

```typescript
const created = await db.users
  .select('id', 'email')
  .create({ name: 'Alice', email: 'alice@example.com' });
// Type: { id: number; email: string }

const updated = await db.users
  .include('posts')
  .where({ id: 42 })
  .update({ name: 'Alice Updated' });
// Type: { ...UserFields, posts: PostRow[] } | null
```

`*Count` variants return `Promise<number>` and do not support projection/include result shaping.
Include loading follows the same capability-based strategy used by read operations.

### 7.2 Update

All update variants **require at least one `where()` filter** (type-state gated).

```typescript
// update — update first match, return it
const user = await db.users
  .where({ id: 42 })
  .update({ name: 'Alice Updated' });
// → Promise<Row | null>

// updateAll — update all matches, return them (streamable)
const users = await db.users
  .where(u => u.role.eq('guest'))
  .updateAll({ active: false });
// → AsyncIterableResult<Row>

// updateCount — update all matches, return count
const count = await db.users
  .where(u => u.role.eq('guest'))
  .updateCount({ active: false });
// → Promise<number>

// Type error — no where():
await db.users.update({ name: 'oops' });

// Whole-table update requires explicit intent:
await db.users.where(all).updateCount({ active: false });
```

### 7.3 Delete

All delete variants **require at least one `where()` filter** (type-state gated).

```typescript
// delete — delete first match, return it
const user = await db.users
  .where({ id: 42 })
  .delete();
// → Promise<Row | null>

// deleteAll — delete all matches, return them (streamable)
const users = await db.users
  .where(u => u.active.eq(false))
  .deleteAll();
// → AsyncIterableResult<Row>

// deleteCount — delete all matches, return count
const count = await db.users
  .where(u => u.active.eq(false))
  .deleteCount();
// → Promise<number>

// Whole-table
await db.users.where(all).deleteCount();
```

### 7.4 Upsert

Insert or update on conflict. Compiles to `INSERT ... ON CONFLICT DO UPDATE`. Returns the affected record.

```typescript
const user = await db.users.upsert({
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice Updated' },
});
// → Promise<Row>

// When multiple unique constraints exist, specify which one:
const user = await db.users.upsert({
  conflictOn: 'email',
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice Updated' },
});
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

### 8.1 Root `aggregate()`

The root collection exposes a single aggregation terminal: `aggregate()`.

This keeps one obvious way to aggregate (instead of separate `count()` / `sum()` / `avg()` terminals) and enables computing **multiple aggregations in one round-trip**.

```typescript
const stats = await db.orders
  .where(o => o.status.eq('completed'))
  .aggregate(a => ({
    count: a.count(),
    total: a.sum('amount'),
    avg: a.avg('amount'),
  }));
// Type: { count: number; total: number | null; avg: number | null }
```

Nullability:
- `count` is always `number`.
- `sum` / `avg` / `min` / `max` are `number | null` (empty input → `null`).

Field arguments for `sum`, `avg`, `min`, `max` are typed to accept only numeric fields.

### 8.2 GroupBy

`groupBy()` produces a **different builder type** (`GroupedCollection`) with distinct type state. It is not chainable with `all()`.

```typescript
const roleStats = await db.users
  .groupBy('role')
  .aggregate(a => ({ count: a.count() }));
// Type: Array<{ role: string; count: number }>

const deptSalaries = await db.employees
  .groupBy('department')
  .aggregate(a => ({
    avgSalary: a.avg('salary'),
    sumSalary: a.sum('salary'),
  }));
// Type: Array<{ department: string; avgSalary: number | null; sumSalary: number | null }>

// With having
const activeDepts = await db.employees
  .groupBy('department')
  .having(h => h.count().gt(5))
  .aggregate(a => ({ count: a.count() }));

// Multi-column
const stats = await db.orders
  .groupBy('status', 'region')
  .having(h => h.count().gt(5))
  .aggregate(a => ({
    count: a.count(),
    total: a.sum('amount'),
  }));
```

`GroupedCollection` has a restricted surface by design. It supports `having` and `aggregate`, but does not expose relation loading or row-query terminals (`all`, `find`, `select`, `include`) or mutation terminals. Aggregation builders (`count`, `sum`, `avg`, `min`, `max`) are available inside the `having` and `aggregate` callbacks.

### 8.3 Aggregations in Includes + `combine()`

Include refinement callbacks do **not** execute queries (they have no `all()` / `find()` terminals). Instead, they return a *query fragment* describing how the include should be loaded.

For **to-many** includes, refinement collections also expose scalar aggregation selectors (`count`, `sum`, `avg`, `min`, `max`). These do not execute either — they describe what the parent include should compute for that relation.

```typescript
const postsWithCommentCount = await db.posts
  .include('comments', c => c.count())
  .all();
// Type: Array<{ ...PostFields, comments: number }>
```

To compute multiple results for a single relation (multiple row branches and/or scalar aggregations), use `combine()`:

```typescript
const posts = await db.posts
  .include('comments', c => {
    const base = c.where({ deleted: false });
    return base.combine({
      approved: base.where({ approved: true }),
      hidden: base.where({ approved: false }),
      totalCount: base.count(),
    });
  })
  .all();
// Type: Array<{
//   ...PostFields,
//   comments: { approved: CommentRow[]; hidden: CommentRow[]; totalCount: number }
// }>
```

Each `combine()` leaf is evaluated against the row-set described by that leaf (so `where` / `orderBy` / `take` / `skip` can be used to scope aggregation selectors, and different leaves can intentionally see different row-sets).

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

### 9.4 Type Mapping

```typescript
type ModelAliasKeys<Name extends string> =
  | Name
  | LowercaseFirst<Name>
  | `${LowercaseFirst<Name>}s`;
```

When a custom collection is provided under a key matching a model alias, the custom collection type takes precedence for that alias, preserving custom methods in the client type.

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

**Status:** Direction established. `aggregate()` is the root aggregation terminal. `sum` / `avg` / `min` / `max` return `number | null`.

Open:
- Should `groupBy` support `.where()` on the grouped builder (before grouping) in addition to `.having()` (after)?
- What is the exact return type shape and naming for multi-aggregation groupBy?

### 11.2 Mutation Method Naming: `create` vs `createOne`

**Status:** Three-variant pattern established (`verb` / `verbAll` / `verbCount`). One naming question remains.

The single-record variant currently uses the bare verb: `create`, `update`, `delete`. An alternative is to use suffixes everywhere for consistency: `createOne`/`createAll`/`createCount`, `updateOne`/`updateAll`/`updateCount`, `deleteOne`/`deleteAll`/`deleteCount`.

Trade-offs:
- Bare verb is shorter and handles the most common case without ceremony.
- Suffixed form is more consistent — every variant has an explicit suffix, no implicit "single" behavior.
- Bare verb has precedent: `find()` (the single-record read) doesn't use `findOne`.

### 11.3 Alternative: Chainable Mutations with Read Terminals

**Status:** Noted as alternative to the suffix approach. Worth revisiting.

Instead of separate method names (`update`/`updateAll`/`updateCount`), mutations could be **chainable** — `update(data)` returns an intermediate "pending mutation" that you terminate with the same read terminals:

```typescript
db.users.where({ id: 42 }).update({ name: 'Bob' }).find()    // → Promise<Row | null>
db.users.where(...).update({ name: 'Bob' }).all()             // → AsyncIterableResult<Row>
db.users.where(...).update({ name: 'Bob' }).aggregate(a => ({ count: a.count() }))  // → Promise<{ count: number }>

db.users.where({ id: 42 }).delete().find()                    // → Promise<Row | null>
db.users.where(...).delete().all()                             // → AsyncIterableResult<Row>
db.users.where(...).delete().aggregate(a => ({ count: a.count() }))  // → Promise<{ count: number }>
```

Pros: Reuses the read vocabulary exactly, no new method names. Cons: `delete().find()` reads oddly (you're not "finding" the deleted row), and mutations become two calls instead of one.

### 11.4 Shorthand Filter Edge Cases

**Status:** Core behavior defined; edge cases need specification.

Defined: `{ field: value }` → equality, multiple fields → AND, `null` → `isNull`.

Defined:
- `{ field: [1, 2, 3] }` → equality check against a scalar list value (not `IN`). For `IN`, use the callback: `.where(u => u.field.in([1, 2, 3]))`.

Open:
- `{ field: undefined }` → silently ignored? (Leaning yes — supports conditional filters.)
- `{}` → identity / no filter? (Leaning yes.)

---

## 12. Replacing the ORM Lane

The ORM client replaces the ORM lane (ADR 015). Once this spec is implemented, the ORM lane package (`@prisma-next/sql-orm-lane`) is deleted and its demo usage is migrated to the ORM client.

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
| `where(filters \| callback)` | `Collection` | Append filter (AND with existing) |
| `include(relation, refine?)` | `Collection` | Load related records |
| `select(...fields)` | `Collection` | Project scalar fields |
| `orderBy(fn \| array)` | `Collection` | Order results |
| `take(n)` | `Collection` | Limit result count |
| `skip(n)` | `Collection` | Offset results |
| `cursor({ field: value })` | `Collection` | Cursor pagination (requires orderBy) |
| `distinct(...fields)` | `Collection` | SELECT DISTINCT |
| `distinctOn(...fields)` | `Collection` | DISTINCT ON (requires orderBy) |
| `groupBy(...fields)` | `GroupedCollection` | Group results and aggregate |

### Terminal Methods — Reads

| Method | Returns | Description |
|--------|---------|-------------|
| `all()` | `AsyncIterableResult<Row>` | All matches; async iterable + thenable (`await` → `Row[]`) |
| `find()` / `find(filters \| callback)` | `Promise<Row \| null>` | First match or null (LIMIT 1); optional filter ANDed with existing `where()` |
| `aggregate(fn)` | `Promise<object>` | Compute one or more aggregations in a single query |

### Terminal Methods — Mutations (Single, requires `returning`)

| Method | Requires `where()` | Returns | Description |
|--------|-------------------|---------|-------------|
| `create(data)` | No | `Promise<Row>` | Insert one record, return it |
| `update(data)` | Yes | `Promise<Row \| null>` | Update first match (LIMIT 1), return it |
| `delete()` | Yes | `Promise<Row \| null>` | Delete first match (LIMIT 1), return it |
| `upsert({ create, update })` | No | `Promise<Row>` | Insert or update on conflict |

### Terminal Methods — Mutations (Multi → Rows, requires `returning`)

| Method | Requires `where()` | Returns | Description |
|--------|-------------------|---------|-------------|
| `createAll(data[])` | No | `AsyncIterableResult<Row>` | Insert records, return them (streamable) |
| `updateAll(data)` | Yes | `AsyncIterableResult<Row>` | Update all matches, return them (streamable) |
| `deleteAll()` | Yes | `AsyncIterableResult<Row>` | Delete all matches, return them (streamable) |

### Terminal Methods — Mutations (Multi → Count, all targets)

| Method | Requires `where()` | Returns | Description |
|--------|-------------------|---------|-------------|
| `createCount(data[])` | No | `Promise<number>` | Insert records, return count |
| `updateCount(data)` | Yes | `Promise<number>` | Update all matches, return count |
| `deleteCount()` | Yes | `Promise<number>` | Delete all matches, return count |

### Standalone Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `and(...exprs)` | `AndExpr` | Combine with AND |
| `or(...exprs)` | `OrExpr` | Combine with OR |
| `not(expr)` | `WhereExpr` | Negate a filter |
| `all()` | `WhereExpr` | Match all records (sentinel for whole-table mutations) |
| `orm(options)` | `OrmClient` | Create typed client |

### GroupedCollection Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `having(predicate)` | `GroupedCollection` | Filter groups |
| `aggregate(fn)` | `Promise<Array<object>>` | Compute one or more aggregations per group |

### Include Refinement Collections (Non-Executing)

Include refinement callbacks receive a non-executing collection surface. These objects support query-building methods (e.g. `where`, `orderBy`, `take`, `skip`, nested `include`) but do not expose terminals like `all()` / `find()` / mutations.

They also support `combine()` to return multiple named branches for a single relation:

| Method | Available in | Description |
|--------|--------------|-------------|
| `combine(spec)` | to-one and to-many includes | Return a named shape of branches (rows and/or scalars) for the relation |

For to-many includes, the refinement collection also exposes scalar aggregation selectors:

These return selector nodes (conceptually `IncludeScalar<T>`) — they do not execute queries on their own, but can be returned directly from the include refinement or used as `combine()` leaves.

| Method | Returns | Description |
|--------|---------|-------------|
| `count()` | `IncludeScalar<number>` | Count matching related records |
| `sum(field)` | `IncludeScalar<number \| null>` | Sum a numeric field |
| `avg(field)` | `IncludeScalar<number \| null>` | Average a numeric field |
| `min(field)` | `IncludeScalar<number \| null>` | Minimum of a field |
| `max(field)` | `IncludeScalar<number \| null>` | Maximum of a field |

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
    .find({ email: 'alice@example.com' });

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

  // Scoped update — single record
  const updated = await db.users
    .where({ id: 42 })
    .update({ name: 'Alice Updated' });

  // Scoped update — all matches, return count
  const deactivated = await db.users
    .where(u => u.role.eq('guest'))
    .where(u => u.lastLoginAt.lt(thirtyDaysAgo))
    .updateCount({ active: false });

  // Aggregation + GroupBy
  const activeStats = await db.users
    .active()
    .aggregate(a => ({ count: a.count() }));

  const roleCounts = await db.users
    .groupBy('role')
    .aggregate(a => ({ count: a.count() }));

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
| `where()` overloads | Callback only | Callback returning `WhereExpr` + shorthand object |
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
| Mutations | Do not exist | Three variants per operation: single (`create`/`update`/`delete`), multi-return (`*All`), count (`*Count`), plus `upsert` |
| Nested mutations | Do not exist | Callback-based (`p => p.create(...)`) |
| Aggregations | Do not exist | Root `aggregate()`, `groupBy(...).aggregate()`, include `count/sum/avg/min/max` + `combine()` |
| Logical combinators | Do not exist | `and()`, `or()`, `not()`, `all()` |
| `orderBy` ergonomics | Returns `{ column, direction }` | Typed accessor with `.asc()` / `.desc()` |
| Type-state tracking | None | Generic parameter tracking hasOrderBy, hasWhere |
| `CollectionState` filters | `FilterExpr[]` | `WhereExpr[]` (PN AST nodes) |
| Collection registry | Does not exist | Propagated through all chaining methods for include refinements |
