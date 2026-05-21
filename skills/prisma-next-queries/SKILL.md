---
name: prisma-next-queries
description: Write Prisma Next queries for Postgres or Mongo — pick a lane (Postgres `db.orm.<Model>` + `db.sql.<table>`; Mongo `db.orm.<root>` + `db.query.from(...)` pipeline builder), filter / project / sort / paginate, eager-load relations with `.include(...)`, Postgres transactions via `db.transaction(...)`, Postgres ORM aggregates via `.aggregate(...)`, Mongo aggregations via the query builder. Use for query, where, match, select, project, orderBy, take, skip, include, eager load, lookup, first, all, count, aggregate, group, create, update, delete, upsert, returning, transaction, db.transaction, drizzle-style, kysely-style, prisma client, db.close, script, script won't exit, hangs, close connection, db.end, pool.end, await using, variant, polymorphism. Also covers result consumption (`.all()` is a Thenable — just `await` it; no `collect()` / `toArray()` helper needed), single-consumption semantics (`RUNTIME.ITERATOR_CONSUMED`), Postgres aggregate nullability (`count` returns `number`, `sum/avg/min/max` return `number | null` per SQL semantics), and range conditions (Postgres chain `.where()` clauses or use `and(...)` — there is no `.between(...)`).
---

# Prisma Next — Queries

> **Edit your data contract. Prisma handles the rest.**

Once the contract is emitted and the DB is up to date, this skill covers everything you do *with* the data: reading, writing, eager-loading relations, aggregating, and the choice between the ORM and the SQL builder.

## When to Use

- User wants to read, write, update, or delete data.
- User wants to include / eager-load relations.
- User wants to paginate, sort, filter, project.
- User wants to wrap operations in a transaction (`db.transaction(...)`).
- User wants to aggregate (`count`, `sum`, `avg`, …).
- User asks about query lanes (ORM vs SQL builder).
- User mentions: *query, select, where, orderBy, take, skip, include, eager load, first, all, count, aggregate, create, update, delete, upsert, returning, drizzle-style, kysely-style, prisma client*.

## When Not to Use

- User wants to add / change a model → `prisma-next-contract`.
- User wants to wire `db.ts` or add middleware → `prisma-next-runtime`.
- User wants to debug a query failure (structured error envelope) → `prisma-next-debug`.

## Key Concepts

Prisma Next ships **two query lanes** per target on the same `db` value from `src/prisma/db.ts`. Check the runtime import (`@prisma-next/postgres/runtime` vs `@prisma-next/mongo/runtime`) before picking examples — the lane names and shapes differ.

**Postgres** (`postgres<Contract>(...)` from `@prisma-next/postgres/runtime`):

- **`db.orm.<Model>`** — ORM, PascalCase model name (`db.orm.User`). Fluent `.where(...).select(...).orderBy(...).all()`, fully typed against `Contract`. Default lane for CRUD with relations.
- **`db.sql.<table>`** — SQL builder, lowercase storage name (`db.sql.user`). Produces a *plan* executed via `db.runtime().execute(plan)`. Use when the ORM is too high-level — explicit `JOIN`, computed projections, set operations, window functions.

**Mongo** (`mongo<Contract>(...)` from `@prisma-next/mongo/runtime`):

- **`db.orm.<root>`** — ORM, lowercased plural contract root (`db.orm.users`, `db.orm.posts`). Same fluent chaining; `.where({ field: value })` object equality is the idiomatic filter form.
- **`db.query`** — typed aggregation-pipeline builder. Start with `db.query.from('<root>')`, chain `.match(...)` / `.project(...)` / `.group(...)` / `.lookup(...)`, terminal with `.build()`. Execute via `(await db.runtime()).execute(plan)`.

Both targets share the contract and connection on one `db` value. Reach for the ORM first; drop to the lower-level lane when the ORM can't express the shape. Lane choice is local — one query function picks one lane, not the whole app.

**Postgres lane decision table:**

| Need | Choose | Why |
|---|---|---|
| Standard CRUD with relations | **ORM (`db.orm.<Model>`)** | Highest ergonomics; fully typed; model-shaped. |
| Eager-load related records | **ORM `.include(...)`** | Composes with `.where` / `.select` / `.orderBy` / `.take` per branch. |
| Aggregate (count, sum, avg) | **ORM `.aggregate(...)`** | Typed result; works with grouping (`.groupBy(...).aggregate(...)`). |
| `INSERT ... RETURNING` / `UPDATE ... RETURNING` typed result | **ORM mutations** (returns updated rows) or **`db.sql.<t>.insert(...).returning(...)`** | ORM returns inserted/updated rows; SQL builder exposes `.returning(...)` explicitly. |
| Computed projection (e.g. `ST_DistanceSphere(location, point) AS meters`) alongside model fields | **SQL builder (`db.sql.<t>`)** | The ORM projects model fields; arbitrary expression projection is the SQL builder's seam. |
| Complex `JOIN`, set operation, window function | **SQL builder** | The ORM doesn't express arbitrary joins. |
| Postgres-specific feature (`LATERAL`, `FILTER`, custom aggregates) | **SQL builder**, falling back to extension operators when the extension provides them | DSL first; extensions can contribute operators (`postgis`, `pgvector`, `cipherstash`). |

**Mongo lane decision table:**

| Need | Choose | Why |
|---|---|---|
| Standard CRUD with reference relations | **ORM (`db.orm.<root>`)** | Collection-shaped; object `.where({ ... })`; `.create` / `.update` / `.delete` / `.upsert`. |
| Eager-load a reference relation | **ORM `.include('<relation>')`** | Lowers to `$lookup`; composes with `.where` / `.select` / `.orderBy` / `.take`. |
| Polymorphic root (discriminated variants) | **ORM `.variant('<VariantName>')`** | Narrows to one variant and injects the discriminator filter. |
| Field-level Mongo updates (`$push`, `$inc`, dot-path `$set`) | **ORM `.update((f) => [f.field.inc(1)])`** | Field-accessor callback; plain-object `.update({ ... })` for whole-field replacement. |
| Aggregation pipeline (group, facet, `$lookup` with reshaping) | **Query builder (`db.query.from(...)`)** | Full pipeline surface; typed row shape through `.build()`. |
| Typed cross-collection join in a pipeline | **Query builder `.lookup((from) => from('users').on(...).as('author'))`** | `$lookup` with compile-time foreign-root checking. |
| Bulk writes with pipeline semantics | **Query builder write terminals** (`.insertOne`, `.updateMany`, `.findOneAndUpdate`, `.upsertOne`, …) | Filtered writes after `.match(...)`; plans execute through the runtime. |

## Workflow — ORM reads (Postgres)

The concept: `db.orm.<Model>` returns a *collection* you compose method-by-method. Each call returns a new collection (immutable chaining); the terminal verb (`.all()` / `.first()` / `.count()` / `.aggregate(...)`) issues the query. Predicates are lambdas over a field proxy: `u.field.<op>(value)`.

```typescript
// src/queries/users.ts — one directory deep under src/, so the import is '../prisma/db'
import { db } from '../prisma/db';

// Find one record by primary key shorthand.
const user = await db.orm.User.first({ id: userId });
// Returns the full row or `null`.

// Find one matching a predicate.
const alice = await db.orm.User
  .where((u) => u.email.eq('alice@example.com'))
  .first();

// Find many with projection, sort, and limit.
const recentUsers = await db.orm.User
  .select('id', 'email', 'createdAt')
  .orderBy((u) => u.createdAt.desc())
  .take(10)
  .all();
```

**Predicates** (`.where(...)`) come in two forms:

```typescript
// Lambda form — full expression power.
db.orm.User.where((u) => u.email.eq('alice@example.com'));

// Shorthand object form — equality on the named fields.
db.orm.User.where({ kind: 'admin' });
```

Operators on the field proxy include `.eq`, `.neq`, `.lt`, `.lte`, `.gt`, `.gte`, `.like`, `.ilike`, `.in([...])`, `.isNull()`, `.isNotNull()`. Extensions add target-specific operators on extension-typed columns (`pgvector`'s `.cosineDistance(...)`, `postgis`'s `.within(...)` / `.intersectsBbox(...)` / `.distanceSphere(...)`, `cipherstash`'s `.cipherstashEq(...)` / `.cipherstashGt(...)` / …).

**There is no `.between(a, b)` operator.** Express ranges either as two chained `.where(...)` clauses (the idiomatic form — clauses AND-compose) or with the `and(...)` combinator inside one clause:

```typescript
// Chained .where() — each clause AND-composes with the previous one.
await db.orm.Sale
  .where((s) => s.day.gte(start))
  .where((s) => s.day.lte(end))
  .all();

// Equivalent with an explicit `and(...)` inside one clause.
import { and } from '@prisma-next/sql-orm-client'; // façade re-export pending — see *What PN doesn't do yet*
await db.orm.Sale
  .where((s) => and(s.day.gte(start), s.day.lte(end)))
  .all();
```

The two forms emit the same SQL. Pick chained `.where()` when each clause adds a separate condition that reads as its own thought; pick `and(...)` when one logical predicate happens to have two parts and you want the visual grouping. Don't reach for a `between` helper — there isn't one.

**Combinators** (`and`, `or`, `not`) compose predicates, and **relation predicates** (`.some(...)`, `.none(...)`, `.every(...)`) recurse into a relation. These currently come from the internal `@prisma-next/sql-orm-client` package — see *What Prisma Next doesn't do yet* for the façade-completeness gap:

```typescript
import { and, or, not } from '@prisma-next/sql-orm-client';

await db.orm.User
  .where((u) =>
    and(
      or(u.kind.eq('admin'), u.email.ilike('%@example.com')),
      not(u.posts.none((p) => p.title.ilike('%draft%'))),
    ),
  )
  .all();
```

**Sorting and pagination.** `.orderBy(...)` accepts a single lambda or an array of lambdas (each calling `.asc()` / `.desc()` on a field). `.take(n)` limits; `.skip(n)` offsets.

```typescript
await db.orm.Post
  .where((p) => p.authorId.eq(userId))
  .orderBy([(p) => p.createdAt.desc(), (p) => p.id.desc()])
  .take(20)
  .all();

// Cursor pagination — order by an indexed unique column and filter past the cursor.
const cursor = lastPostFromPreviousPage.createdAt;
await db.orm.Post
  .where((p) => p.createdAt.lt(cursor))
  .orderBy((p) => p.createdAt.desc())
  .take(20)
  .all();
```

**`.first()` vs `.first({ pk })` vs `.all()`.** Use `.first()` for a single row (issues a `LIMIT 1`); use `.first({ pk })` for primary-key lookups; reserve `.all()` for the genuine many case (no implicit `LIMIT`).

### Consuming the result: `await`, `.toArray()`, or `for await`

Critical to get right early — on **both Postgres and Mongo**, `.all()` returns an **`AsyncIterableResult<Row>`**, which is *both* a `PromiseLike<Row[]>` and an `AsyncIterable<Row>`. That means three consumption forms all work, and the canonical one is the shortest:

```typescript
const users = await db.orm.User.select('id', 'email').all();
//    ^? Row[]   ← the Thenable resolves to a real array. This is the default idiom.
```

You do **not** need a `collect()` / `toArray()` helper — `await` is enough. Internally `await` invokes the result's `then(...)`, which buffers the rows into an array. Two equivalent alternatives exist for the cases where they read better:

```typescript
// Explicit buffering — same outcome as `await ... .all()`, useful when you
// want a named Promise<Row[]> to thread through downstream code.
const rows: Promise<User[]> = db.orm.User.select('id', 'email').all().toArray();

// Streaming — process rows one at a time without buffering the whole result.
// Use for genuinely large result sets (anything that wouldn't fit comfortably
// in memory) or pipelines where you can start work before all rows arrive.
for await (const user of db.orm.User.select('id', 'email').all()) {
  process(user);
}
```

Two single-row shortcuts also exist on the result, in addition to the collection-level `.first()` (which issues `LIMIT 1`):

```typescript
const user = await db.orm.User.where({ id }).all().first();
//    ^? Row | null   ← buffers, returns the first row or null. Issues no LIMIT.
const required = await db.orm.User.where({ id }).all().firstOrThrow();
//    ^? Row          ← buffers; throws `RUNTIME.NO_ROWS` if empty.
```

For genuine single-row reads, prefer the *collection*-level `.first()` (which adds `LIMIT 1` to the SQL) over `.all().first()` (which fetches all rows and discards the rest). The result-level helpers are for cases where you already need the full result and want the first row without an extra round-trip.

**The result is single-consumption.** Each `AsyncIterableResult` instance can be consumed once — by `await`, by `.toArray()`, or by `for await`. Trying to consume it a second time throws **`RUNTIME.ITERATOR_CONSUMED`**. The fix is almost always to store the array in a variable on first consumption and reuse the variable:

```typescript
// Bad — second await throws RUNTIME.ITERATOR_CONSUMED.
const result = db.orm.User.select('id', 'email').all();
const a = await result;
const b = await result;

// Good — buffer once, reuse the array.
const users = await db.orm.User.select('id', 'email').all();
const a = users;
const b = users;
```

If you've seen `collect(...)` / `toArray(...)` helpers in a codebase wrapping `.all()`, they're vestigial — `await` does the same thing for free. Remove them when you touch the surrounding code.

## Workflow — ORM reads (Mongo)

The concept matches Postgres — `db.orm.<root>` returns a collection you compose method-by-method — but roots are **lowercased plurals** from the emitted contract (`users`, `posts`, not `User` / `Post`), and filters are usually **object equality**:

```typescript
// src/queries/users.ts — adjust the relative import to match file depth.
import { db } from '../prisma/db';

// All users.
const users = await db.orm.users.all();

// Single row by equality filter.
const alice = await db.orm.users.where({ email: 'alice@example.com' }).first();

// Projection, sort, pagination — same chaining as Postgres.
const recent = await db.orm.posts
  .select('title', 'authorId', 'createdAt')
  .orderBy({ createdAt: -1 })
  .take(10)
  .all();
```

**`.where(...)`** accepts a plain object whose keys are model field names and values are compared with equality (codec-aware — `ObjectId` fields accept string ids from the contract). Chain multiple `.where({ ... })` calls to AND-compose filters.

For operators the object form doesn't cover (`.in([...])`, range comparisons, nested logic), pass a `MongoFilterExpr` — today that means importing filter helpers from `@prisma-next/mongo-query-ast/execution` (a façade-completeness gap; see *What Prisma Next doesn't do yet*). Prefer the object form whenever equality suffices.

**Polymorphic roots.** When the contract declares variants on a model, narrow before querying:

```typescript
const articles = await db.orm.posts.variant('Article').all();
const tutorials = await db.orm.posts.variant('Tutorial').where({ authorId }).all();
```

**Sorting and pagination.** `.orderBy({ field: 1 | -1 })` (Mongo sort directions). `.take(n)` maps to `$limit`; `.skip(n)` maps to `$skip`.

**`.first()` vs `.all()`.** `.first()` issues a limit-1 read; `.all()` returns every matching document. There is no `.first({ pk })` shorthand on Mongo — filter on `_id` explicitly: `.where({ _id: id }).first()`.

Mongo `.all()` returns the same `AsyncIterableResult` shape as Postgres — `await db.orm.users.all()` yields an array; see *Consuming the result* below (applies to both targets).

## Workflow — Eager-loading relations (`.include`) — Postgres

The concept: `.include('<relation>', (branch) => branch.<chain>)` adds a relation branch to the parent query. The branch is its own collection — compose `.where` / `.select` / `.orderBy` / `.take` on it just like the parent.

```typescript
await db.orm.User
  .select('id', 'email')
  .include('posts', (post) =>
    post
      .select('id', 'title', 'createdAt')
      .orderBy((p) => p.createdAt.desc())
      .take(5),
  )
  .take(10)
  .all();
// → Array<{ id, email, posts: Array<{ id, title, createdAt }> }>
```

Nested `1:N → 1:N` includes (e.g. `User → posts → comments`) require the contract to advertise the `lateral` + `jsonAgg` capabilities for the active target. The Postgres adapter advertises both by default, so most apps get this for free; if the type system rejects a nested include with a *missing capability* error, route to `prisma-next-contract` to add the required capability declarations and use `prisma-next-queries` for query-shape guidance.

## Workflow — Eager-loading relations (`.include`) — Mongo

Mongo reference relations eager-load through the same `.include('<relation>')` surface; the ORM lowers to `$lookup`:

```typescript
const posts = await db.orm.posts
  .include('author')
  .orderBy({ createdAt: -1 })
  .all();
// → Array<{ title, authorId, createdAt, author: { name, email, ... } }>
```

Relation names match the contract's `@relation` field names. Nested includes follow the same chaining rules as the parent collection.

## Workflow — ORM writes (Postgres)

```typescript
// Create — returns the inserted row.
const user = await db.orm.User.create({ id, email, displayName, kind, createdAt });

// Create with selected return — narrows the return shape.
const summary = await db.orm.User
  .select('id', 'email', 'kind')
  .create({ id, email, displayName, kind, createdAt });

// Update by predicate.
await db.orm.User.where({ id }).update({ email: newEmail });

// Update with selected return.
await db.orm.User
  .where({ id })
  .select('id', 'email', 'kind')
  .update({ email: newEmail });

// Delete by predicate.
await db.orm.User.where({ id }).delete();

// Upsert — typed by the create branch's shape.
await db.orm.User
  .select('id', 'email', 'kind', 'createdAt')
  .upsert({
    create: { id, email, displayName, kind, createdAt: new Date() },
    update: { email, displayName, kind },
  });
```

The ORM returns inserted / updated rows by default. The `.returning(...)` selector lives on the SQL builder (next section), where you build a plan and execute it explicitly.

## Workflow — ORM writes (Mongo)

Mongo mutations require a preceding `.where(...)` filter (except `.create` / `.createAll`). Updates accept either a partial document or a field-accessor callback for Mongo operators:

```typescript
// Create — returns the row with server-assigned `_id`.
const user = await db.orm.users.create({
  name: 'Alice',
  email: 'alice@example.com',
  bio: null,
  address: null,
});

// Update one — plain object replaces top-level fields.
await db.orm.users.where({ _id: user._id }).update({ bio: 'Writer' });

// Update one — field operations ($push, $inc, dot-path $set).
await db.orm.users
  .where({ _id: user._id })
  .update((u) => [u.tags.push('admin'), u.loginCount.inc(1)]);

// Update many / delete many — iterate or count.
const updated = await db.orm.users
  .where({ bio: null })
  .updateAll({ bio: 'filled' });
for await (const row of updated) { /* each modified doc */ }

await db.orm.users.where({ _id: user._id }).delete();

// Upsert — filter via .where(), split create vs update branches.
await db.orm.users.where({ email: 'alice@example.com' }).upsert({
  create: { name: 'Alice', email: 'alice@example.com', bio: null, address: null },
  update: { bio: 'Editor' },
});
```

**Count-only terminals.** `.createCount(...)`, `.updateCount(...)`, `.deleteCount()` return numbers without re-reading full documents — useful for bulk operations where you only need the modified count.

**Upsert + dot-path.** The upsert `update` callback cannot use dot-path field operations — use top-level field replacement in the upsert branch or a separate `.update((u) => [...])` call.

## Workflow — Aggregates (Postgres)

```typescript
const totals = await db.orm.User.aggregate((aggregate) => ({
  totalUsers: aggregate.count(),
}));

const adminTotals = await db.orm.User
  .where({ kind: 'admin' })
  .aggregate((aggregate) => ({
    adminUsers: aggregate.count(),
  }));

// Group-by + aggregate.
const byKind = await db.orm.User
  .groupBy('kind')
  .having((having) => having.count().gte(minUsers))
  .aggregate((aggregate) => ({
    totalUsers: aggregate.count(),
  }));
```

`aggregate` exposes `.count()`, `.sum(field)`, `.avg(field)`, `.min(field)`, `.max(field)`. Project the aggregates into named result keys; the result type narrows accordingly.

**Aggregate nullability matches SQL semantics:**

| Aggregate | Type | Empty result |
|---|---|---|
| `count()` | `number` | `0` |
| `sum(field)` | `number \| null` | `null` (SQL `SUM` over zero rows is `NULL`) |
| `avg(field)` | `number \| null` | `null` |
| `min(field)` | `number \| null` | `null` |
| `max(field)` | `number \| null` | `null` |

This isn't a typing bug — it's faithful to what the database returns. Coalesce client-side when you want zero-fill:

```typescript
const revenue = await db.orm.Sale
  .where((s) => s.day.gte(start))
  .aggregate((a) => ({ total: a.sum('amount') }));
// revenue.total: number | null

const safe = revenue.total ?? 0;   // ← apply at the consumption site, not in the aggregate spec.
```

If `?? 0` is showing up on every aggregate, that's a signal you're calling `sum` (or peers) over potentially-empty filters — which is exactly when SQL returns NULL. The pattern is correct; the typing is honest.

## Workflow — Aggregates (Mongo)

The Mongo ORM does not expose `.aggregate(...)` / `.groupBy(...)`. Express aggregations through **`db.query`** — the pipeline builder — with `.group(...)` and accumulator helpers:

```typescript
import { acc } from '@prisma-next/mongo-query-builder';

const runtime = await db.runtime();
const plan = db.query
  .from('posts')
  .match((f) => f.authorId.eq(authorId))
  .group((f) => ({
    _id: f.kind,
    postCount: acc.count(),
    latest: acc.max(f.createdAt),
  }))
  .sort({ postCount: -1 })
  .build();

const byKind = await runtime.execute(plan);
```

Import `acc` and expression helpers (`fn`) from `@prisma-next/mongo-query-builder` when building computed pipeline stages.

## Workflow — SQL builder (`db.sql.<table>`) — Postgres

The concept: `db.sql.<table>` is a table-shaped builder that produces a *plan*. The plan is a serialisable description of the query (AST + parameters); you execute it through the runtime with `db.runtime().execute(plan)`. The builder gives you the lanes the ORM doesn't express — explicit `JOIN`, arbitrary expression projection, target-specific operations through extension helpers — without dropping to raw SQL.

```typescript
// src/queries/posts.ts — adjust the relative import to match file depth.
import { db } from '../prisma/db';

// Select with predicate and limit.
const plan = db.sql.post
  .select('id', 'title', 'userId', 'createdAt')
  .where((f, fns) => fns.eq(f.userId, userId))
  .limit(limit)
  .build();

const rows = await db.runtime().execute(plan);
```

The `.where(...)` callback receives `(fields, fns)` — `fields` is the field proxy (column references), `fns` is the operator namespace (`fns.eq`, `fns.ne`, `fns.gt`, …). Extensions inject extension-shaped helpers into the same `fns` namespace (`fns.distanceSphere`, `fns.cosineDistance`, etc.).

### `INSERT` / `UPDATE` / `DELETE` with `RETURNING`

```typescript
// Insert and return selected columns.
const plan = db.sql.user
  .insert({ email })
  .returning('id', 'email')
  .build();
const [row] = await db.runtime().execute(plan);

// Update with predicate and returning.
const updatePlan = db.sql.user
  .update({ email: newEmail })
  .where((f, fns) => fns.eq(f.id, userId))
  .returning('id', 'email')
  .build();
const rows = await db.runtime().execute(updatePlan);

// Delete with predicate.
const deletePlan = db.sql.user
  .delete()
  .where((f, fns) => fns.eq(f.id, userId))
  .build();
await db.runtime().execute(deletePlan);
```

`.returning(...)` requires the target adapter to advertise the `returning` capability. The Postgres adapter advertises it by default.

### Computed projections and joins

```typescript
// Project a computed expression alongside model fields.
const plan = db.sql.cafe
  .select('id', 'name')
  .select('meters', (f, fns) => fns.distanceSphere(f.location, point))
  .orderBy((f, fns) => fns.distanceSphere(f.location, point), { direction: 'asc' })
  .orderBy((f) => f.id, { direction: 'asc' })
  .limit(limit)
  .build();
const rows = await db.runtime().execute(plan);

// Self-join with an alias.
db.sql.post
  .innerJoin(db.sql.post.as('p2'), (f, fns) => fns.ne(f.p1.userId, f.p2.userId))
  // ...
  .build();
```

## Workflow — Query builder (`db.query`) — Mongo

The concept: `db.query.from('<root>')` starts a typed aggregation-pipeline chain. Terminal methods produce a `MongoQueryPlan`; execute it through the runtime:

```typescript
// src/queries/analytics.ts
import { acc, fn } from '@prisma-next/mongo-query-builder';
import { db } from '../prisma/db';

const runtime = await db.runtime();

// Read pipeline — match, project, sort, limit.
const plan = db.query
  .from('posts')
  .match((f) => f.authorId.eq(authorId))
  .sort({ createdAt: -1 })
  .limit(10)
  .project('title', 'authorId', 'createdAt')
  .build();
const recent = await runtime.execute(plan);

// Cross-collection join ($lookup).
const withAuthor = db.query
  .from('posts')
  .lookup((from) =>
    from('users')
      .on((local, foreign) => ({
        local: local.authorId,
        foreign: foreign._id,
      }))
      .as('author'),
  )
  .build();
const rows = await runtime.execute(withAuthor);
```

**Filters — `.match(...)`.** Callback form: `.match((f) => f.status.eq('active'))`. Filters AND-compose across chained `.match(...)` calls. Field accessors support property access (`f.email`), callable dot paths (`f('address.city').eq('NYC')`), and `f.rawPath('path')` for migration/backfill paths outside the current contract.

**Write terminals on the builder.** After `.from('users')` or `.from('users').match(...)`, use insert/update/delete terminals:

```typescript
await runtime.execute(
  db.query.from('users').insertOne({ name: 'Alice', email: 'a@e.com', bio: null }),
);

await runtime.execute(
  db.query
    .from('users')
    .match((f) => f.name.eq('Alice'))
    .updateMany((f) => [f.bio.set('filled')]),
);

await runtime.execute(
  db.query
    .from('users')
    .match((f) => f.email.eq('a@e.com'))
    .findOneAndUpdate((f) => [f.bio.set('updated')], { returnDocument: 'after' }),
);
```

Update callbacks return arrays of field operations (`.set`, `.inc`, `.push`, `.pull`, …). Pipeline-style updates use `f.stage.set(...)` inside an aggregation chain, then `.updateMany()` with no callback.

**Plans vs ORM.** The ORM's `.create` / `.update` / `.all` issue queries directly. Don't pass ORM collections to `runtime.execute` — that entry point is for `db.query` plans (and migration/runtime internals).

## Workflow — Transactions (Postgres)

The concept: `db.transaction(fn)` opens a transaction and passes a `tx` context to the callback. `tx.orm` and `tx.sql` mirror `db.orm` / `db.sql` but ride the same transaction; `tx.execute(plan)` executes a SQL-builder plan within it. The transaction commits on the callback's successful return and rolls back on any thrown error.

```typescript
await db.transaction(async (tx) => {
  const user = await tx.orm.User.create({ id, email });
  await tx.orm.Post.create({ userId: user.id, title: 'hello' });

  // SQL-builder plan inside the transaction.
  const plan = tx.sql.post.update({ status: 'archived' })
    .where((f, fns) => fns.lt(f.createdAt, cutoff))
    .build();
  await tx.execute(plan);

  // If anything throws, all three operations roll back.
});
```

The callback's return value passes through `db.transaction(...)`. Capture inserted ids out of the callback and use them downstream after commit.

**Mongo:** the `@prisma-next/mongo/runtime` façade does not expose `db.transaction(...)` today. Multi-document atomicity requires MongoDB transactions on a replica set via the driver — not yet wrapped in the Prisma Next façade. Route to *What Prisma Next doesn't do yet* / `prisma-next-feedback` if the user needs this.

## Running queries from a short script

When the user is running a one-off `tsx my-script.ts` (not a long-lived server), call `await db.close()` at the end so the process exits cleanly — on Postgres the façade-owned pool keeps Node's event loop alive; on Mongo the façade-owned `MongoClient` does the same. See `prisma-next-runtime` § *Running as a script (teardown)* for the full pattern including `await using`.

```typescript
// src/scripts/seed.ts
import { db } from '../prisma/db';

for (const u of users) {
  await db.orm.User.create(u);
}
console.log('Seeded.');

await db.close();
```

## Common Pitfalls

1. **Using Postgres examples on a Mongo project (or vice versa).** Check `db.ts`: `@prisma-next/postgres/runtime` → `db.orm.User` + `db.sql.user`; `@prisma-next/mongo/runtime` → `db.orm.users` + `db.query.from('users')`. There is no `db.sql` on Mongo.
2. **Reaching for the lower-level lane when the ORM would have done.** The ORM covers most CRUD shapes; drop to `db.sql` / `db.query` only for shapes the ORM can't express. Default to the ORM.
3. **Using `.all()` when you wanted one row.** `.all()` issues no implicit limit. Use `.first()` (Postgres also has `.first({ pk })`) or filter + `.first()` on Mongo.
4. **Writing a `collect()` / `toArray()` helper to convert `.all()` to an array.** `.all()` returns an `AsyncIterableResult<Row>` which *is* a `PromiseLike<Row[]>` — `await collection.all()` directly yields `Row[]`. The helpers some codebases ship are vestigial. See *Consuming the result*.
5. **Consuming an `AsyncIterableResult` twice.** Each result is single-use. The second consumer throws `RUNTIME.ITERATOR_CONSUMED`. Buffer once into a variable and reuse the variable.
6. **Coalescing `count()` with `?? 0` "just in case" (Postgres ORM aggregates).** `count()` is `number`, not `number | null` — the runtime already substitutes `0` for the empty case. The `?? 0` belongs on `sum` / `avg` / `min` / `max`, whose `number | null` shape is faithful to SQL semantics over empty result sets.
7. **Reaching for `.between(a, b)` on a Postgres field proxy.** It doesn't exist. Either chain `.where((m) => m.field.gte(a)).where((m) => m.field.lte(b))` or use `and(m.field.gte(a), m.field.lte(b))` inside one `.where()` clause.
8. **Importing `and` / `or` / `not` from a Postgres façade subpath.** The combinators currently live in `@prisma-next/sql-orm-client` — an internal package. See *What Prisma Next doesn't do yet*.
9. **Trying to `db.sql.from(tables.user)` (Postgres).** That surface does not exist. The builder is table-shaped: `db.sql.<tableName>.select(...)`. There is no `db.schema.tables` either.
10. **Trying to `db.execute(plan)` directly (Postgres).** Plans execute through the runtime: `db.runtime().execute(plan)`. Inside a transaction, use `tx.execute(plan)`. On Mongo, `(await db.runtime()).execute(plan)`.
11. **Setting `capabilities: { includeMany: true }` in `prisma-next.config.ts`.** `defineConfig` does not take `capabilities`. Capabilities are declared by the active adapter and become part of the emitted contract; the Postgres adapter advertises `lateral`, `jsonAgg`, and `returning` out of the box. Enable extension capabilities through `extensions: [...]` in the config (see `prisma-next-contract`).
12. **Confabulating a `db.sql.raw(...)`, TypedSQL, or `.stream()` surface (Postgres).** None of those exist today. See *What Prisma Next doesn't do yet*.
13. **Mixing the ORM mutation return with `runtime.execute(plan)`.** ORM terminals issue the query themselves and return rows. `runtime.execute` is for SQL-builder / query-builder plans.
14. **Top-N grouped queries written as `groupBy(...).aggregate(...).sort().slice()` in JS (Postgres).** That's a fallback because the grouped collection doesn't expose `.orderBy(...)` / `.take(...)`. Fine at small cardinalities; for large grouped result sets, drop to `db.sql.<table>`.
15. **Calling Mongo ORM `.update()` / `.delete()` without `.where()`.** Mutations other than `.create` / `.createAll` require a filter — the compiler enforces this at the type level where possible.
16. **Using PascalCase model names on Mongo ORM.** Roots are lowercased plurals from the contract (`db.orm.users`, not `db.orm.User`).
17. **Expecting Postgres-style lambda `.where((u) => u.email.eq(...))` on Mongo ORM.** Prefer object equality `.where({ email: '...' })`; richer operators need `MongoFilterExpr` helpers (façade gap today).

## What Prisma Next doesn't do yet

- **`and` / `or` / `not` combinators in the postgres façade.** The combinators currently import from `@prisma-next/sql-orm-client` (an internal package). Tracked alongside other façade-completeness gaps in Linear `TML-2526`. Workaround today: import them from `@prisma-next/sql-orm-client` directly, the way the example apps do. If you want them on `@prisma-next/postgres/runtime`, file a feature request via `prisma-next-feedback`.
- **`.orderBy(...)` / `.take(...)` on grouped aggregates.** `db.orm.<Model>.groupBy(...).aggregate(...)` materializes a `Promise<Array<Group & Aggregates>>` and exposes neither ordering nor row limits at the DB layer. Result: a "top-N groups by SUM" query falls back to JS-side sort + slice over the full grouped result, which is fine at small cardinalities and bad at scale. Workarounds: (a) drop to `db.sql.<table>` and write the `GROUP BY` + `ORDER BY` + `LIMIT` against the aggregated table directly; (b) live with the JS-side sort/slice if the grouped cardinality is bounded. File a feature request via `prisma-next-feedback` if this is hitting you in production.
- **A raw-SQL lane.** Prisma Next does not currently expose a user-facing raw-SQL surface (no `db.sql.raw(...)`). Workaround: model the query through the SQL builder or — for shapes the builder can't yet express — file a feature request via `prisma-next-feedback` describing the shape so the team can decide whether to grow the builder or ship a raw lane.
- **TypedSQL (`.sql` files compiled into typed callables).** Not implemented. Workaround: stick to the SQL builder; for repeated queries, extract a function that returns the built plan and call `db.runtime().execute(plan)` at the call site. If you want a `.sql`-file compile path, file a feature request via `prisma-next-feedback`.
- **`EXPLAIN` / query-plan inspection.** Prisma Next does not expose an `.explain()` method. Workaround: connect a `pg.Pool` you control via the runtime's `pg:` binding (see `prisma-next-runtime`) and issue `EXPLAIN ANALYZE` through it. If you want a first-class plan-inspection surface, file a feature request via `prisma-next-feedback`.
- **Streaming large result sets.** No `.stream()` cursor today. Workaround: paginate via `.skip(n).take(m)` for moderate sizes; for very large sets, hold a `pg.Client` from the runtime's `pg:` binding and stream through it directly. If you want a built-in streaming surface, file a feature request via `prisma-next-feedback`.
- **Multi-statement batching (Prisma-7-style `db.$transaction([call1, call2])`).** Prisma Next runs each call sequentially. Workaround: wrap atomically-related work in `db.transaction(async (tx) => { ... })` on Postgres. If you want batch-as-array semantics, file a feature request via `prisma-next-feedback`.
- **Mongo façade transactions.** `@prisma-next/mongo/runtime` does not expose `db.transaction(...)`. Multi-document atomicity is not yet wrapped in the Prisma Next Mongo façade. Workaround: use the MongoDB driver's session API directly if you control the client binding (`mongoClient:` option). File a feature request via `prisma-next-feedback` if you need a first-class façade surface.
- **Mongo ORM aggregates.** No `.aggregate(...)` / `.groupBy(...)` on `db.orm.<root>`. Workaround: express aggregations through `db.query.from(...).group(...).build()` and `runtime.execute(plan)`.
- **Mongo filter helpers on the façade.** Rich filters (`.in`, ranges, boolean composition) currently import from `@prisma-next/mongo-query-ast/execution` (`MongoFieldFilter`, etc.) — not yet re-exported on `@prisma-next/mongo/runtime`. Workaround: use object equality `.where({ field: value })` where possible; import from the internal package only when necessary. Tracked alongside façade-completeness gaps in Linear `TML-2526`.
- **Automatic N+1 detection.** Prisma Next does not warn when an `.include(...)` is missing. Workaround: be deliberate about `.include(...)` in code review; the `lints` middleware (see `prisma-next-runtime`) catches the more common authoring slips (missing `WHERE` on a `DELETE` / `UPDATE`, missing `LIMIT` on a `SELECT`).

## Reference Files

This skill is intentionally body-only. The authoritative surfaces are:

**Postgres**

- Example queries under [`examples/prisma-next-demo/src/orm-client/`](https://github.com/prisma/prisma-next/tree/main/examples/prisma-next-demo/src/orm-client) and [`examples/prisma-next-demo/src/queries/`](https://github.com/prisma/prisma-next/tree/main/examples/prisma-next-demo/src/queries) — canonical ORM and SQL-builder shapes.
- ORM client source under `packages/3-extensions/sql-orm-client/src/`.
- SQL builder source under `packages/2-sql/4-lanes/sql-builder/src/`.

**Mongo**

- Example queries under [`examples/mongo-demo/src/server.ts`](https://github.com/prisma/prisma-next/tree/main/examples/mongo-demo/src/server.ts) — ORM reads, `.include`, `.variant`, and pipeline DSL via `db.query`.
- Integration tests under `examples/mongo-demo/test/` (`blog.test.ts`, `crud-lifecycle.test.ts`, `query-builder-writes.test.ts`).
- Query builder README under `packages/2-mongo-family/5-query-builders/query-builder/README.md`.
- ORM collection surface under `packages/2-mongo-family/5-query-builders/orm/src/collection.ts`.

## Checklist

- [ ] Confirmed the active target from `db.ts` before choosing lane names (`User` vs `users`, `db.sql` vs `db.query`).
- [ ] Chose the right lane (ORM by default; lower-level builder for shapes the ORM doesn't express).
- [ ] Used `.first()` / `.first({ pk })` (Postgres) or `.where({ ... }).first()` (Mongo) for single-row reads — not `.all()`.
- [ ] Consumed `.all()` with plain `await` (not a `collect()` / `toArray()` helper). Used `for await` only when streaming is actually wanted, and never iterated the same result twice.
- [ ] Coalesced Postgres `sum` / `avg` / `min` / `max` results with `?? 0` at the consumption site when zero-fill is desired — did NOT coalesce `count()`, which is `number`.
- [ ] Expressed Postgres ranges as chained `.where(...)` clauses or a single `and(...)` clause — did NOT reach for a non-existent `.between(...)` operator.
- [ ] For Postgres ORM combinators, imported `and` / `or` / `not` from the (currently internal) `@prisma-next/sql-orm-client` and noted the façade gap to the user.
- [ ] Executed Postgres SQL-builder plans via `db.runtime().execute(plan)` (or `tx.execute(plan)` inside a transaction).
- [ ] Executed Mongo query-builder plans via `(await db.runtime()).execute(plan)`.
- [ ] Wrapped multi-statement Postgres work in `db.transaction(async (tx) => { ... })` where atomicity matters — did NOT confabulate `db.transaction` on Mongo.
- [ ] Did NOT confabulate `db.sql.raw`, TypedSQL, `.stream()`, `db.batch`, `.between(...)`, a `capabilities` field on `defineConfig`, or a `db.sql.from(tables.user)` API — routed to *What Prisma Next doesn't do yet* / `prisma-next-feedback` instead.
- [ ] Did NOT use `db.sql` on a Mongo project or `db.query` where the Postgres SQL builder is meant.
- [ ] For top-N grouped aggregates at meaningful scale on Postgres, dropped to `db.sql.<table>` rather than JS-side sort + slice over `groupBy(...).aggregate(...)`.
- [ ] For Mongo aggregations, used `db.query.from(...).group(...)` rather than a non-existent ORM `.aggregate(...)`.
- [ ] Did NOT use the lower-level builder for something the ORM cleanly expresses.
