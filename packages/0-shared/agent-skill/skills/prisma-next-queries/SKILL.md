---
name: prisma-next-queries
description: Write Prisma Next queries — pick a query interface (SQL query builder, ORM client, Raw SQL, TypedSQL), select/filter/sort/paginate, include relations, INSERT/UPDATE/DELETE, transactions, capability-gated features. Use for query, where, select, orderBy, take, limit, include, eager loading, raw SQL, transaction, returning, includeMany, EXPLAIN, prepared statements, drizzle, kysely, prisma client, db.batch.
---

# Prisma Next — Queries

> **Edit your data contract. Prisma handles the rest.**

Once the contract is in place and the DB is up to date, this skill
covers everything you do with the data: reading, writing,
transactions, capability-gated features, and the choice of query
interface.

## When to Use

- User wants to read, write, update, or delete data.
- User wants to include / eager-load relations.
- User wants to paginate, sort, filter, project.
- User wants to wrap operations in a transaction.
- User wants to use a capability-gated feature (`returning()`,
  `includeMany`).
- User asks about query interfaces (DSL vs ORM vs raw SQL vs TypedSQL).
- User mentions: *query, select, where, orderBy, take, include, eager
  load, raw SQL, transaction, returning, drizzle-style, kysely-style,
  prisma client, db.batch*.

## When Not to Use

- User wants to add/change a model → `prisma-next-contract`.
- User wants to wire `db.ts` or add middleware → `prisma-next-runtime`.
- User wants to debug a query failure → `prisma-next-debug`.

## Key Concepts (before any workflow)

Prisma Next ships three runtime surfaces on top of one contract:

- **`db.sql`** — SQL query builder. Composable, typed, returns
  builders that you `.build()` and execute. Closest to raw SQL with
  type safety.
- **`db.orm`** — ORM client. Higher-level, model-shaped (`db.orm.User
  .select(...).all()`). Default choice for most reads and writes.
- **`db.sql.raw\`...\``** — Raw SQL escape hatch. Use when the other
  interfaces don't cover what you need. Returns rows untyped unless
  annotated.
- **TypedSQL** — author a `.sql` file with typed params and result
  types; PN compiles it into a callable function. Use for complex
  queries you want type-checked.

**Default: `db.orm`.** Fall back to `db.sql` when you need composition
the ORM doesn't express. Fall back to raw SQL only when neither
covers it.

## Decision: which query interface

| Need | Choose | Why |
|---|---|---|
| Standard CRUD with relations | **ORM (`db.orm`)** | Highest ergonomics, fully typed, model-shaped. |
| Complex JOIN, window function, CTE | **SQL DSL (`db.sql.from(...)`)** | Composable + typed without writing SQL strings. |
| Postgres-specific feature (LATERAL, FILTER, aggregates) | **SQL DSL** if expressible, else **Raw SQL** | DSL first; raw is the escape hatch. |
| Performance-tuned query with EXPLAIN | **Raw SQL** | EXPLAIN integration isn't first-class (see capability gaps). |
| Reusable parameterised query | **TypedSQL** | Compiles a `.sql` file into a typed callable. |
| Bulk inserts / mutations | **ORM `createMany` / SQL DSL `insert`** | Either works; ORM is simpler. |

## ORM workflow — basic reads

```typescript
import { db } from './prisma/db';

// Find one record by primary key
const user = await db.orm.User.first({ id: 42 });
// Returns { id: number; email: string; ... } | null

// Find one matching a predicate
const alice = await db.orm.User
  .where(u => u.email.eq('alice@example.com'))
  .first();

// Find many
const recentUsers = await db.orm.User
  .select('id', 'email', 'createdAt')
  .orderBy(u => u.createdAt.desc())
  .take(10)
  .all();
```

### Predicates (`.where(...)`)

`u => u.field.<op>(value)` — operators include:

- `.eq(v)`, `.neq(v)` — equality.
- `.lt(v)`, `.lte(v)`, `.gt(v)`, `.gte(v)` — comparisons.
- `.ilike(v)`, `.like(v)` — string match (case-insensitive / case-sensitive).
- `.in([v1, v2, ...])` — set membership.
- `.isNull()`, `.isNotNull()` — null checks.

Combine with `and(...)` / `or(...)`:

```typescript
import { and, or } from '@prisma-next/postgres/runtime';

await db.orm.User
  .where(u => or(
    u.role.eq('ADMIN'),
    and(u.role.eq('USER'), u.email.ilike('%@example.com')),
  ))
  .all();
```

### Projection (`.select(...)`)

```typescript
// Pass field names — return type is narrowed.
await db.orm.User.select('id', 'email').all();
// → Array<{ id: number; email: string }>

// Omit `.select` to return every field.
await db.orm.User.first({ id: 42 });
// → { id, email, name, role, ... } | null
```

### Sorting and pagination

```typescript
await db.orm.Post
  .where(p => p.authorId.eq(userId))
  .orderBy(p => p.createdAt.desc())
  .take(20)
  .all();

// Cursor pagination: order by an indexed unique column, take + filter.
const cursor = lastPostFromPreviousPage.createdAt;
await db.orm.Post
  .where(p => p.createdAt.lt(cursor))
  .orderBy(p => p.createdAt.desc())
  .take(20)
  .all();
```

### `.first()` vs `.first({ id })` vs `.all()`

```typescript
// Bad: .all() and array-destructure when you want one record.
const [user] = await db.orm.User.where(u => u.id.eq(42)).all();
// Inefficient; runs without a LIMIT.

// Good: use .first() with a predicate.
const user = await db.orm.User.where(u => u.id.eq(42)).first();

// Better when looking up by primary key: .first({ pk-fields }).
const user = await db.orm.User.first({ id: 42 });
```

### Include relations (`.include(...)`)

```typescript
const usersWithPosts = await db.orm.User
  .select('id', 'email')
  .include('posts', post =>
    post
      .select('id', 'title', 'createdAt')
      .orderBy(p => p.createdAt.desc())
      .take(5),
  )
  .take(10)
  .all();
// → Array<{ id, email, posts: Array<{ id, title, createdAt }> }>
```

### `includeMany` (capability-gated)

For deeply nested `1:N → 1:N` loads where each parent may have many
children. Capability-gated: must be enabled in the contract's
`capabilities` block.

```typescript
// prisma-next.config.ts
import { definePnConfig } from '@prisma-next/postgres/config';

export default definePnConfig({
  // ...
  capabilities: {
    includeMany: true,
  },
});
```

Then:

```typescript
await db.orm.User
  .include('posts', post => post.include('comments', c => c.all()))
  .all();
```

Without the capability, `include` of a many-relation off a many-load
errors at type-check.

## ORM workflow — writes

```typescript
// Insert
const user = await db.orm.User.create({ email: 'alice@example.com' });
// Returns the inserted row.

// Update by primary key
await db.orm.User.update({ id: 42 }, { email: 'alice+new@example.com' });

// Update many
await db.orm.User
  .where(u => u.role.eq('USER'))
  .update({ role: 'GUEST' });

// Delete by primary key
await db.orm.User.delete({ id: 42 });

// Delete many
await db.orm.User.where(u => u.deletedAt.isNotNull()).deleteMany();
```

### `returning()` (capability-gated)

Postgres supports `RETURNING` on writes; enable to get a typed result
back from updates / deletes without a second query.

```typescript
// prisma-next.config.ts
capabilities: { returning: true }
```

Then:

```typescript
const updated = await db.orm.User
  .where(u => u.role.eq('USER'))
  .update({ role: 'GUEST' })
  .returning('id', 'email');
// → Array<{ id: number; email: string }>
```

## SQL DSL workflow — `db.sql`

```typescript
const tables = db.schema.tables;

const plan = db.sql
  .from(tables.user)
  .select({
    id: tables.user.columns.id,
    email: tables.user.columns.email,
  })
  .where(tables.user.columns.role.eq('ADMIN'))
  .orderBy(tables.user.columns.createdAt.desc())
  .limit(10)
  .build();

const rows = await db.execute(plan);
```

Use the DSL when the ORM is too high-level — explicit JOIN, set
operations, window functions, raw expressions, or when you need
column-level control over projection.

### JOIN

```typescript
db.sql
  .from(tables.user)
  .innerJoin(tables.post, tables.post.columns.authorId.eq(tables.user.columns.id))
  .select({
    userEmail: tables.user.columns.email,
    postTitle: tables.post.columns.title,
  })
  .build();
```

## Raw SQL with annotations

```typescript
import { db } from './prisma/db';

const rows = await db.sql.raw<{ id: number; email: string }>`
  SELECT id, email FROM "user" WHERE role = ${'ADMIN'}
`;
// Returns Array<{ id: number; email: string }>
```

Parameters in `${...}` are bound (not interpolated as text). The type
parameter annotates the row shape. Always parameterize; never
interpolate user input into the SQL string.

## TypedSQL — author a `.sql` file

```sql
-- src/queries/active-users.sql
-- @param days Int
-- @returns { id: Int, email: String }
SELECT id, email
FROM "user"
WHERE "lastSeen" > NOW() - INTERVAL ':days days';
```

PN compiles `active-users.sql` into a typed callable at emit time:

```typescript
import { activeUsers } from './queries/active-users.generated';

const rows = await activeUsers(db, { days: 7 });
// → Array<{ id: number; email: string }>
```

Use for queries you'd otherwise write as raw SQL but want type checked
end-to-end.

## Transactions

```typescript
await db.transaction(async (tx) => {
  const user = await tx.orm.User.create({ email: 'bob@example.com' });
  await tx.orm.Post.create({ authorId: user.id, title: 'hello' });
  // If any throw, both insert ops roll back.
});
```

- `tx` exposes the same `orm`, `sql`, `execute` surfaces as `db`.
- The transaction commits on the callback's successful return.
- Any thrown error rolls back.

## Custom ORM collections

Add domain helpers without leaving the ORM surface:

```typescript
// src/orm-extensions/post-helpers.ts
import { db } from '../prisma/db';

export const PostHelpers = {
  published: () =>
    db.orm.Post.where(p => p.status.eq('published')),

  byAuthor: (authorId: number) =>
    db.orm.Post.where(p => p.authorId.eq(authorId)),
};

// Usage
const recent = await PostHelpers.published()
  .orderBy(p => p.createdAt.desc())
  .take(20)
  .all();
```

PN doesn't have ActiveRecord-style scopes built in; this pattern is the
idiomatic substitute.

## Streaming large result sets

For result sets too large to materialize:

```typescript
const cursor = db.sql
  .from(tables.event)
  .select(tables.event.columns.payload)
  .orderBy(tables.event.columns.id.asc())
  .stream();

for await (const row of cursor) {
  process(row.payload);
}
```

Not all targets support streaming uniformly; PN exposes it where the
underlying driver does (Postgres: yes; Mongo: yes via cursors).

## Common Pitfalls

1. **Reaching for raw SQL too soon.** The ORM covers most cases; the
   DSL covers most of the rest. Raw SQL bypasses type safety; use it
   as a last resort.
2. **Using `.all()` when you wanted one row.** Returns every row
   without a LIMIT. Use `.first()` or `.first({ pk })`.
3. **Forgetting to enable a capability before using it.** `returning()`,
   `includeMany`, and other capability-gated features error at type-
   check if the capability isn't on. Enable in `prisma-next.config.ts`.
4. **Interpolating user input into a raw SQL string.** SQL injection.
   Always use the `${...}` template-tag binding.
5. **Using the ORM through `db.execute(...)`** — the ORM returns its
   results when you call `.all()` / `.first()` / etc.; you don't pass
   the builder to `db.execute()` separately (that's for SQL DSL plans).

## What Prisma Next doesn't do yet

- **`EXPLAIN` / query plan inspection.** Prisma Next doesn't expose an
  `.explain()` method. Workaround: `db.sql.raw\`EXPLAIN ANALYZE
  ${someQuery}\``. If you need first-class plan inspection, file a
  feature request: file a feature request via the `prisma-next-feedback` skill.
- **Prepared statements as a user-facing surface.** PN's adapters
  prepare under the hood for parameterized queries, but you can't
  pre-prepare a statement and re-execute by name. Workaround: use
  TypedSQL (which compiles to a typed callable) or the raw lane. If
  you need first-class prepared statements, file a feature request via the `prisma-next-feedback` skill.
- **`db.batch()` / multi-statement batching.** Prisma Next runs each
  call sequentially. Workaround: wrap in a transaction (`db.transaction`),
  or use raw SQL with a `;`-separated statement set. If you need
  Prisma-7-style `db.$transaction([call1, call2])` batching, file a
  feature request: file a feature request via the `prisma-next-feedback` skill.
- **Automatic N+1 detection.** Prisma Next does not warn when an
  `.include()` is missing. Workaround: be deliberate about includes
  in code review; the capability-gated `includeMany` is the manual
  approach for explicit many-load chains. If you need automatic N+1
  warnings, file a feature request via the `prisma-next-feedback` skill.

## Reference Files

- `references/orm-api.md` — full ORM client API (`.where`, `.select`, `.orderBy`, `.include`, mutations).
- `references/sql-dsl-api.md` — SQL query builder.
- `references/typed-sql.md` — TypedSQL annotations + compile flow.
- `references/predicate-operators.md` — every `.<op>` predicate operators support.
- `references/capability-gates.md` — list of capability-gated features and how to enable them.

## Checklist

- [ ] Chose the right query interface (ORM first; DSL when ORM is too high-level; raw SQL last).
- [ ] Used `.first()` / `.first({ pk })` for single-row reads — not `.all()`.
- [ ] Parameterized any raw SQL (no string interpolation of user input).
- [ ] Enabled capabilities (`returning`, `includeMany`) in `prisma-next.config.ts` if needed.
- [ ] Wrapped multi-statement work in a transaction where atomicity matters.
- [ ] Did NOT confabulate `EXPLAIN`, `db.batch()`, or prepared statements — pointed at the capability-gap section instead.
- [ ] Did NOT use raw SQL for something the ORM or DSL covers.
