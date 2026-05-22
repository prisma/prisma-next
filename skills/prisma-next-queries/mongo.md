# Prisma Next — Queries (Mongo)

> Load this guide when `db.ts` imports from `@prisma-next/mongo/runtime`.

Shared concepts (result consumption, script teardown, cross-target pitfalls, capability gaps) live in [`SKILL.md`](./SKILL.md).

## Key Concepts

**Mongo** (`mongo<Contract>(...)` from `@prisma-next/mongo/runtime`):

- **`db.orm.<root>`** — ORM, lowercased plural contract root (`db.orm.users`, `db.orm.posts`). Same fluent chaining; `.where({ field: value })` object equality is the idiomatic filter form.
- **`db.query`** — typed aggregation-pipeline builder. Start with `db.query.from('<root>')`, chain `.match(...)` / `.project(...)` / `.group(...)` / `.lookup(...)`, terminal with `.build()`. Execute via `(await db.runtime()).execute(plan)`.

Reach for the ORM first; drop to `db.query` when the ORM can't express the shape. Lane choice is local — one query function picks one lane, not the whole app.

**Lane decision table:**

| Need | Choose | Why |
|---|---|---|
| Standard CRUD with reference relations | **ORM (`db.orm.<root>`)** | Collection-shaped; object `.where({ ... })`; `.create` / `.update` / `.delete` / `.upsert`. |
| Eager-load a reference relation | **ORM `.include('<relation>')`** | Lowers to `$lookup`; composes with `.where` / `.select` / `.orderBy` / `.take`. |
| Polymorphic root (discriminated variants) | **ORM `.variant('<VariantName>')`** | Narrows to one variant and injects the discriminator filter. |
| Field-level Mongo updates (`$push`, `$inc`, dot-path `$set`) | **ORM `.update((f) => [f.field.inc(1)])`** | Field-accessor callback; plain-object `.update({ ... })` for whole-field replacement. |
| Aggregation pipeline (group, facet, `$lookup` with reshaping) | **Query builder (`db.query.from(...)`)** | Full pipeline surface; typed row shape through `.build()`. |
| Typed cross-collection join in a pipeline | **Query builder `.lookup((from) => from('users').on(...).as('author'))`** | `$lookup` with compile-time foreign-root checking. |
| Bulk writes with pipeline semantics | **Query builder write terminals** (`.insertOne`, `.updateMany`, `.findOneAndUpdate`, `.upsertOne`, …) | Filtered writes after `.match(...)`; plans execute through the runtime. |

## Workflow — ORM reads

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

For operators the object form doesn't cover (`.in([...])`, range comparisons, nested logic), pass a `MongoFilterExpr` — today that means importing filter helpers from `@prisma-next/mongo-query-ast/execution` (a façade-completeness gap; see *What Prisma Next doesn't do yet* in [`SKILL.md`](./SKILL.md)). Prefer the object form whenever equality suffices.

**Polymorphic roots.** When the contract declares variants on a model, narrow before querying:

```typescript
const articles = await db.orm.posts.variant('Article').all();
const tutorials = await db.orm.posts.variant('Tutorial').where({ authorId }).all();
```

**Sorting and pagination.** `.orderBy({ field: 1 | -1 })` (Mongo sort directions). `.take(n)` maps to `$limit`; `.skip(n)` maps to `$skip`.

**`.first()` vs `.all()`.** `.first()` issues a limit-1 read; `.all()` returns every matching document. There is no `.first({ pk })` shorthand on Mongo — filter on `_id` explicitly: `.where({ _id: id }).first()`.

Mongo `.all()` returns the same `AsyncIterableResult` shape as Postgres — `await db.orm.users.all()` yields an array; see *Consuming the result* in [`SKILL.md`](./SKILL.md).

## Workflow — Eager-loading relations (`.include`)

Mongo reference relations eager-load through the same `.include('<relation>')` surface; the ORM lowers to `$lookup`:

```typescript
const posts = await db.orm.posts
  .include('author')
  .orderBy({ createdAt: -1 })
  .all();
// → Array<{ title, authorId, createdAt, author: { name, email, ... } }>
```

Relation names match the contract's `@relation` field names. Nested includes follow the same chaining rules as the parent collection.

## Workflow — ORM writes

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

## Workflow — Aggregates

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

## Workflow — Query builder (`db.query`)

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

## Common Pitfalls (Mongo)

1. **Reaching for the lower-level lane when the ORM would have done.** Default to the ORM; drop to `db.query` only for shapes the ORM can't express.
2. **Using `.all()` when you wanted one row.** Use `.where({ ... }).first()` — not `.all()`.
3. **Calling `.update()` / `.delete()` without `.where()`.** Mutations other than `.create` / `.createAll` require a filter — the compiler enforces this at the type level where possible.
4. **Using PascalCase model names on ORM.** Roots are lowercased plurals from the contract (`db.orm.users`, not `db.orm.User`).
5. **Expecting Postgres-style lambda `.where((u) => u.email.eq(...))` on ORM.** Prefer object equality `.where({ email: '...' })`; richer operators need `MongoFilterExpr` helpers (façade gap today).
6. **Expecting `db.transaction(...)`.** The Mongo façade does not expose it today. Multi-document atomicity requires MongoDB transactions on a replica set via the driver — not yet wrapped in the Prisma Next façade. Route to *What Prisma Next doesn't do yet* / `prisma-next-feedback` if the user needs this.
7. **Trying to use `db.sql`.** There is no `db.sql` on Mongo.
8. **Trying to `db.execute(plan)` directly.** Execute query-builder plans via `(await db.runtime()).execute(plan)`.
9. **Expecting ORM `.aggregate(...)` / `.groupBy(...)`.** Use `db.query.from(...).group(...).build()` instead.

## Reference Files

- Example queries under [`examples/mongo-demo/src/server.ts`](examples/mongo-demo/src/server.ts) — ORM reads, `.include`, `.variant`, and pipeline DSL via `db.query`.
- Integration tests under `examples/mongo-demo/test/` (`blog.test.ts`, `crud-lifecycle.test.ts`, `query-builder-writes.test.ts`).
- Query builder README under `packages/2-mongo-family/5-query-builders/query-builder/README.md`.
- ORM collection surface under `packages/2-mongo-family/5-query-builders/orm/src/collection.ts`.

## Checklist

- [ ] Used lowercased plural ORM roots (`db.orm.users`, not `db.orm.User`).
- [ ] Chose the right lane (ORM by default; `db.query` for shapes the ORM doesn't express).
- [ ] Used `.where({ ... }).first()` for single-row reads — not `.all()`.
- [ ] Executed query-builder plans via `(await db.runtime()).execute(plan)`.
- [ ] For aggregations, used `db.query.from(...).group(...)` rather than a non-existent ORM `.aggregate(...)`.
- [ ] Did NOT confabulate `db.transaction`, `db.sql`, or ORM `.aggregate(...)` — routed to *What Prisma Next doesn't do yet* / `prisma-next-feedback` instead.
- [ ] Did NOT use the lower-level builder for something the ORM cleanly expresses.
