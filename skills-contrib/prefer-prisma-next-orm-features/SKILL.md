---
name: prefer-prisma-next-orm-features
description: >-
  About to fetch related rows with a second query and stitch them in application
  code, loop-create children after creating a parent, run multi-step writes
  without a transaction, filter a broad result set in memory, or select all
  columns then pluck a few — when working against Prisma Next's ORM collection
  API (`orm()`, `db.orm`, `tx.orm`) or SQL DSL (`db.sql`, `sql()`). Fires
  whenever an agent reaches for hand-rolled relation loading, nested writes,
  transactions, relation filters, or field projection instead of the built-in
  `.include()`, nested `create`/`connect`/`disconnect` mutators,
  `db.transaction()`, `.some()`/`.none()`/`.every()` relation filters, and
  `.select()`. Prisma Next is not the legacy Prisma Client: there is no
  `prisma.model.findMany({ include })` and no `$transaction` here.
---

# Prefer Prisma Next's built-in ORM features

Prisma Next ships a contract-first ORM collection API (`orm()` / `db.orm` / `tx.orm`) and a type-safe SQL DSL (`db.sql` / `sql()`). They natively express relation loading, nested writes, transactions, relation filters, and field projection. Use them. Don't re-implement those concerns in application code by issuing extra queries, stitching rows by id, or filtering/limiting in memory.

This is **not** the legacy Prisma Client. The `prisma.model.findMany({ include, select })`, `prisma.$transaction(...)`, and `connect`/`updateMany` shorthand from that API do not exist here. The examples below are the real Prisma Next surface, taken from the demo and example apps.

## Shared example schema

Prisma Next authors schemas as `.prisma` (PSL) files, then emits `contract.json` + `contract.d.ts` from them. The examples below assume this schema:

```prisma
model User {
  id          String   @id @default(uuid())
  email       String
  displayName String
  createdAt   DateTime @default(now())
  posts       Post[]
  @@map("user")
}

model Post {
  id        String   @id @default(uuid())
  title     String
  userId    String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  tags      Tag[]
  @@map("post")
}

model Tag {
  id    String @id @default(uuid())
  label String @unique
  posts Post[]
  @@map("tag")
}

model PostTag {
  postId String
  tagId  String
  post   Post @relation(fields: [postId], references: [id])
  tag    Tag  @relation(fields: [tagId], references: [id])
  @@id([postId, tagId])
  @@map("post_tag")
}
```

## Client setup

```typescript
import postgres from '@prisma-next/postgres/runtime'
import { orm } from '@prisma-next/sql-orm-client'
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context'
import type { Contract } from './prisma/contract.d'
import contractJson from './prisma/contract.json' with { type: 'json' }

export const db = postgres<Contract>({ contractJson, url: process.env.DATABASE_URL })
const context = db.context as ExecutionContext<Contract>

async function app() {
  await using runtime = await db.connect()
  const client = orm({ runtime, context }).public
  // client.User, client.Post, client.Tag — collection accessors per namespace
}
```

The same client type is available directly as `db.orm` and, inside a transaction, as `tx.orm`. Every collection chains the same methods regardless of how you obtained it.

## 1. Load related data in a single query — `.include()`

Use `.include('relation', (ref) => ...)` to load relations in one round-trip. The refinement callback is itself a collection: it supports `.select()`, `.where()`, `.orderBy()`, `.take()`, and even `.variant()` for polymorphic relations. To-one (`user`), to-many (`posts`), and many-to-many (`tags`, walked through the junction transparently) all use the same mechanism.

**Anti-pattern** — N+1: fetch parents, then loop a query per parent.

```typescript
const users = await client.User.newestFirst().take(limit).all()
const posts = await Promise.all(
  users.map((u) => client.Post.where({ userId: u.id }).take(3).all()),
)
// two round-trips plus one per user; results stitched by hand
```

**Recommended** — one query with `.include()`.

```typescript
const users = await client.User
  .newestFirst()
  .select('id', 'displayName', 'kind')
  .include('posts', (post) =>
    post
      .orderBy((p) => p.createdAt.desc())
      .take(3)
      .select('id', 'title', 'createdAt'),
  )
  .take(limit)
  .all()
```

One round-trip; the junction and join are handled by the runtime. Rationale: the database is better at joins than your loop is, and `.include()` keeps the relation typed and decoded end-to-end.

## 2. Nested writes — `create` / `connect` / `disconnect` mutators

Create, update, and upsert accept relation fields as callback mutators. `t.create([...])` inserts new related rows; `t.connect([{ id }])` links existing ones; `t.disconnect([{ id }])` unlinks them (update only). A to-one relation can be created inline by passing the nested value directly. A single nested mutation is atomic — the ORM wraps the whole graph in a transaction internally.

**Anti-pattern** — fetch-then-modify-then-save: create the parent, then loop-create children and junction rows by hand.

```typescript
const post = await client.Post.create({ title, userId })
for (const label of labels) {
  const tag = await client.Tag.byLabel(label).first()
  // then a separate call to insert each PostTag junction row…
}
```

**Recommended** — one nested mutation.

```typescript
// create a post and create new tags in the same call (M:N)
const post = await client.Post.create({
  title,
  userId,
  tags: (t) => t.create(labels.map((label) => ({ label }))),
})

// create a post and link already-existing tags in the same call
const linked = await client.Post.create({
  title,
  userId,
  tags: (t) => t.connect(tagIds.map((id) => ({ id }))),
})

// link/unlink on an existing post via update
const updated = await client.Post
  .where({ id })
  .select('id', 'title')
  .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
  .update({ tags: (t) => t.connect([{ id: tagId }]) })

const unlinked = await client.Post
  .where({ id })
  .update({ tags: (t) => t.disconnect([{ id: tagId }]) })

// inline to-one nested create (address embedded in the user row)
const user = await client.User
  .select('id', 'email', 'kind', 'address')
  .create({ email, displayName, kind: 'user', address: { street, city, country } })
```

Rationale: the ORM owns the ordering, the junction inserts, and the transaction so the graph commits or rolls back as one unit.

## 3. Multi-step operations — `db.transaction()`

For operations that must commit or roll back together, wrap them in `db.transaction(async (tx) => ...)`. The callback receives a transaction context whose `tx.orm`, `tx.sql`, and `tx.execute` are all bound to the same transaction; it commits on return and rolls back on throw. This is also the tool when one step's result gates the next.

**Anti-pattern** — separate writes that have to be atomic but aren't.

```typescript
const existing = await client.Post.where({ userId }).all()
if (existing.length + titles.length > MAX_POSTS_PER_USER) throw new QuotaExceededError()
const posts = await Promise.all(
  titles.map((title) => client.Post.select('id', 'title', 'userId').create({ title, userId })),
)
// the count check and the inserts are not atomic: two callers can both pass and overshoot
```

**Recommended** — `db.transaction()`.

```typescript
return db.transaction(async (tx) => {
  // count with the SQL builder bound to the transaction
  const countRows = await tx.execute(
    tx.sql.public.post
      .select('postCount', (_f, fns) => fns.count())
      .where((f, fns) => fns.eq(f.userId, userId))
      .build(),
  )
  const existingCount = Number(countRows[0]?.postCount ?? 0)
  if (existingCount + titles.length > MAX_POSTS_PER_USER) {
    throw new QuotaExceededError(userId, existingCount, titles.length, MAX_POSTS_PER_USER)
  }

  // create with the ORM client bound to the same transaction
  const posts = await Promise.all(
    titles.map((title) =>
      tx.orm.Post.select('id', 'title', 'userId').create({ title, userId }),
    ),
  )
  return { existingCount, posts }
})
```

For the lower-level escape hatch when you only have a `Runtime` (no `db` facade), use `withTransaction(runtime, async (tx) => { await tx.execute(plan) })` from `@prisma-next/sql-runtime`. Rationale: the check and the writes share one transactional scope, so concurrent callers can't jointly overshoot.

## 4. Relation filters in `where` — `.some()` / `.none()` / `.every()`

Inside a `.where((x) => ...)` callback, a relation field exposes `.some()`, `.none()`, and `.every()` predicates that fold the relation into the WHERE clause at the database level. Combine them with `and`, `or`, `not` from `@prisma-next/sql-orm-client`. Field operators include `.eq`, `.neq`, `.gt`, `.lt`, `.gte`, `.lte`, `.like`, `.ilike`, `.in([...])`, `.notIn([...])`, `.isNull()`, `.isNotNull()`.

**Anti-pattern** — fetch a broad set and filter in memory.

```typescript
const posts = await client.Post.select('id', 'title').all()
const withTag = posts.filter(/* … joined to tags in JS … */)
```

**Recommended** — relation filters in the query.

```typescript
import { and, not, or } from '@prisma-next/sql-orm-client'

// posts that have at least one tag with this label
const some = await client.Post
  .where((p) => p.tags.some((t) => t.label.eq(label)))
  .select('id', 'title')
  .all()

// posts that have no tag with this label
const none = await client.Post
  .where((p) => p.tags.none((t) => t.label.eq(label)))
  .select('id', 'title')
  .all()

// posts where every tag differs from this label (vacuous-truth: untagged posts match)
const every = await client.Post
  .where((p) => p.tags.every((t) => t.label.neq(label)))
  .select('id', 'title')
  .all()

// admins (or a domain) who have at least one post matching a title term
const users = await client.User
  .where((user) =>
    and(
      or(user.kind.eq('admin'), user.email.ilike(`%@${domain}`)),
      not(user.posts.none((post) => post.title.ilike(`%${term}%`))),
    ),
  )
  .select('id', 'email', 'kind', 'createdAt')
  .all()
```

Rationale: pushing the predicate into the query avoids transferring rows you'll throw away, and `.every()`'s vacuous-truth semantics (untagged posts match "every tag differs") are already handled correctly by the runtime.

## 5. Limit returned fields — `.select()`

Call `.select('col1', 'col2', ...)` on the root collection and on each included relation to project only what you need. It composes with reads and with the read-back shape of `create` / `update` / `upsert`.

**Anti-pattern** — select all columns, then pluck two in code.

```typescript
const rows = await client.User.where({ kind: 'admin' }).all()
const view = rows.map((u) => ({ id: u.id, email: u.email }))
```

**Recommended** — project at the database.

```typescript
const view = await client.User
  .where({ kind: 'admin' })
  .select('id', 'email')
  .all()

// projection on the root and on an included relation together
const feed = await client.Post
  .where((p) => p.title.ilike(`%${term}%`))
  .select('id', 'title', 'createdAt')
  .include('user', (user) => user.select('id', 'email', 'kind'))
  .orderBy((p) => p.createdAt.desc())
  .take(limit)
  .all()

// projection also shapes the row returned by a write
const updated = await client.User
  .where({ id })
  .select('id', 'email', 'kind')
  .update({ email })
```

Rationale: `.select()` is the same mechanism as relation limiting — there is one projection surface for both, so use it everywhere you don't need the full row.

## Escape hatch: the SQL DSL

When the ORM collection API can't express something, drop to the SQL DSL (`db.sql` / `tx.sql` / `sql({ context })`) before dropping to raw SQL. It builds typed plans you run with `runtime.execute(plan)` or `tx.execute(plan)`:

```typescript
// aggregate via the SQL builder inside a transaction
const rows = await tx.execute(
  tx.sql.public.post
    .select('postCount', (_f, fns) => fns.count())
    .where((f, fns) => fns.eq(f.userId, userId))
    .build(),
)

// insert with RETURNING
const plan = db.sql.public.user
  .insert([{ email, displayName, createdAt: new Date() }])
  .returning('id', 'email')
  .build()
const inserted = await db.runtime().execute(plan)
```

Reach for this when you need aggregates, `RETURNING`, or query shapes the ORM doesn't expose — not as a reason to hand-roll joins or transactions.

## Quick reference

| Concern | Prisma Next feature |
| --- | --- |
| Load relations in one query | `.include('rel', (ref) => ref.select(...).where(...).orderBy(...).take(...))` |
| Create + nested rows | `.create({ ..., rel: (t) => t.create([...]) })` |
| Link existing rows | `.create({ ..., rel: (t) => t.connect([{ id }]) })` or `.update({ rel: (t) => t.connect([...]) })` |
| Unlink rows | `.update({ rel: (t) => t.disconnect([{ id }]) })` |
| Atomic multi-step write | `db.transaction(async (tx) => { tx.orm...; tx.sql...; tx.execute(plan) })` |
| Filter by related rows | `.where((x) => x.rel.some((r) => r.field.eq(val)))` / `.none(...)` / `.every(...)`, with `and` / `or` / `not` |
| Limit columns | `.select('col1', 'col2')` on root and inside `.include()` |
| Order + limit + run | `.orderBy((x) => x.field.desc()).take(n).all()` or `.first()` |

When in doubt, search `examples/prisma-next-demo/src/orm-client/` and `examples/prisma-next-demo-sqlite/src/` for a runnable pattern before writing your own — those files compile and execute against the real implementation.
