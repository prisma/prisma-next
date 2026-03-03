# Prisma ORM vs Prisma Next — API Comparison

This document compares Prisma ORM's `PrismaClient` API with the Prisma Next ORM Client API specified in `spec.md`. Section 1 covers side-by-side equivalents. Section 2 covers capabilities unique to Prisma Next. Section 3 shows deeply nested queries side by side.

---

## 1. Side-by-Side Comparisons

### Setup

**Prisma ORM:**
```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
```

**Prisma Next:**
```typescript
import { orm, Collection } from '@prisma-next/sql-orm-client'

const db = orm({ contract, runtime })
```

---

### all (findMany)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany()
```

**Prisma Next:**
```typescript
const users = await db.users.all()

// Streaming — rows arrive as they're read from the database
for await (const user of db.users.all()) {
  process.stdout.write(JSON.stringify(user) + '\n')
}
```

Both return all records. In Prisma Next, `all()` returns an `AsyncIterableResult` that is both async-iterable (for streaming) and thenable (so `await` collects into an array). The query is sent eagerly when `all()` is called — only reading the response is lazy.

---

### first (findFirst / findUnique)

**Prisma ORM:**
```typescript
// findFirst — first match
const user = await prisma.user.findFirst({
  where: { email: 'alice@example.com' },
})

// findUnique — by unique constraint
const user = await prisma.user.findUnique({
  where: { email: 'alice@example.com' },
})
```

**Prisma Next:**
```typescript
// first() with inline filter — covers both findFirst and findUnique use cases
const user = await db.users.first({ email: 'alice@example.com' })

// first() with prior where()
const user = await db.users
  .where(u => u.active.eq(true))
  .first({ email: 'alice@example.com' })

// first() with no argument — first match from accumulated filters
const firstAdmin = await db.users
  .where(u => u.role.eq('admin'))
  .first()
```

Prisma Next has a single `first()` method that returns `Promise<Row | null>` (LIMIT 1). It supports the same two filter overloads as `where()` — shorthand object (`first({ email: 'alice@example.com' })`) and callback (`first(u => u.email.eq('alice@example.com'))`). Raw `WhereExpr` is not accepted directly as an argument. Any provided filter is ANDed with existing filters.

---

### Simple Filters (where)

**Prisma ORM:**
```typescript
const admins = await prisma.user.findMany({
  where: { role: 'admin' },
})
```

**Prisma Next:**
```typescript
// Shorthand (same shape as Prisma ORM's where)
const admins = await db.users.where({ role: 'admin' }).all()

// Callback with typed accessor
const admins = await db.users.where(u => u.role.eq('admin')).all()
```

`where()` has two overloads only: shorthand object or callback returning `WhereExpr`.

---

### Compound Filters (AND / OR / NOT)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  where: {
    OR: [
      { email: { contains: '@example.com' } },
      { role: 'admin' },
    ],
    NOT: { active: false },
  },
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .where(u => and(
    or(u.email.ilike('%@example.com'), u.role.eq('admin')),
    not(u.active.eq(false)),
  ))
  .all()
```

Prisma ORM uses nested objects (`AND`, `OR`, `NOT` keys). Prisma Next uses composable functions (`and()`, `or()`, `not()`).

---

### Comparison Operators

**Prisma ORM:**
```typescript
const recent = await prisma.user.findMany({
  where: {
    createdAt: { gte: thirtyDaysAgo },
    email: { contains: '@example.com', mode: 'insensitive' },
    role: { in: ['admin', 'moderator'] },
    deletedAt: null,
  },
})
```

**Prisma Next:**
```typescript
const recent = await db.users
  .where(u => and(
    u.createdAt.gte(thirtyDaysAgo),
    u.email.ilike('%@example.com'),
    u.role.in(['admin', 'moderator']),
    u.deletedAt.isNull(),
  ))
  .all()
```

Prisma ORM uses nested objects for operators (`{ gte: ... }`). Prisma Next uses method calls on typed field accessors (`.gte()`, `.ilike()`, `.in()`).

---

### Relational Filters (some / every / none)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  where: {
    posts: {
      some: { published: true },
    },
  },
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .where(u => u.posts.some(p => p.published.eq(true)))
  .all()
```

Same naming (`some`, `every`, `none`). Prisma Next uses callbacks instead of nested objects, which enables IDE autocompletion on the related model's fields.

---

### Composability of Filters

Filters can be defined as free functions so you can use them anywhere a filter is expected and compose them with other filters:

```typescript
function publishedPosts(posts: Collection<Contract, 'Post'>) {
  return posts.where(p => p.published.eq(true))
}
```

TODO: figure out how we could build reusable filters that work on generic models (e.g. any model that has an `email` field).

---

### Include (Eager Loading)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  include: { posts: true },
})
```

**Prisma Next:**
```typescript
const users = await db.users.include('posts').all()
```

---

### Include with Filters

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  include: {
    posts: {
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    },
  },
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .include('posts', p =>
    p.where(post => post.published.eq(true))
     .orderBy(post => post.createdAt.desc())
     .take(5)
  )
  .all()
```

Prisma ORM nests options inside the include object. Prisma Next uses a refinement callback that receives a Collection for the related model, so the same chainable API is used at every level.

---

### Nested Includes

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  include: {
    posts: {
      include: {
        comments: true,
      },
    },
  },
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .include('posts', p => p.include('comments'))
  .all()
```

---

### Select (Field Projection)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  select: { id: true, email: true },
})
```

**Prisma Next:**
```typescript
const users = await db.users.select('id', 'email').all()
```

Prisma ORM uses `{ field: true }` objects. Prisma Next uses string arguments. In Prisma ORM, `select` and `include` are mutually exclusive. In Prisma Next, they are complementary (see section 2).

---

### OrderBy

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  orderBy: [
    { lastName: 'asc' },
    { firstName: 'asc' },
  ],
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .orderBy([u => u.lastName.asc(), u => u.firstName.asc()])
  .all()
```

---

### Pagination (Offset)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  skip: 20,
  take: 10,
  orderBy: { createdAt: 'desc' },
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .orderBy(u => u.createdAt.desc())
  .skip(20)
  .take(10)
  .all()
```

---

### Pagination (Cursor)

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  cursor: { id: 42 },
  skip: 1,
  take: 10,
  orderBy: { id: 'asc' },
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .orderBy(u => u.id.asc())
  .cursor({ id: 42 })
  .take(10)
  .all()
```

---

### Distinct

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  distinct: ['role'],
})
```

**Prisma Next:**
```typescript
const users = await db.users.distinct('role').all()

// Or DISTINCT ON (Postgres) with required ordering:
const users = await db.users
  .orderBy(u => u.createdAt.desc())
  .distinctOn('email')
  .all()
```

---

### Create

**Prisma ORM:**
```typescript
const user = await prisma.user.create({
  data: { email: 'alice@example.com', name: 'Alice' },
})
```

**Prisma Next:**
```typescript
const user = await db.users.create({
  email: 'alice@example.com',
  name: 'Alice',
})
```

Prisma Next drops the `data:` wrapper — the fields are the top-level argument.

---

### Update

**Prisma ORM:**
```typescript
// Single record
const user = await prisma.user.update({
  where: { id: 42 },
  data: { name: 'Alice Updated' },
})

// Batch — returns count only
await prisma.user.updateMany({
  where: { role: 'guest' },
  data: { active: false },
})
```

**Prisma Next:**
```typescript
// Single record — update first match, return it
const user = await db.users
  .where({ id: 42 })
  .update({ name: 'Alice Updated' })

// All matches — return affected rows (streamable)
const users = await db.users
  .where(u => u.role.eq('guest'))
  .updateAll({ active: false })

// All matches — return count
const count = await db.users
  .where(u => u.role.eq('guest'))
  .updateCount({ active: false })
```

Prisma ORM has `update` (single, requires unique where) and `updateMany` (batch, returns count only). There is also `updateManyAndReturn` (Postgres/CockroachDB/SQLite only) that returns affected rows. Prisma Next has three variants: `update` (first match, return it), `updateAll` (all matches, return rows), `updateCount` (all matches, return count). `update` and `updateAll` require the `returning` capability; `updateCount` works on all targets.

---

### Delete

**Prisma ORM:**
```typescript
const user = await prisma.user.delete({
  where: { id: 42 },
})

await prisma.user.deleteMany({
  where: { active: false },
})
```

**Prisma Next:**
```typescript
// Single — delete first match, return it
const user = await db.users.where({ id: 42 }).delete()

// All matches — return affected rows (streamable)
const users = await db.users.where(u => u.active.eq(false)).deleteAll()

// All matches — return count
const count = await db.users.where(u => u.active.eq(false)).deleteCount()
```

---

### Upsert

**Prisma ORM:**
```typescript
const user = await prisma.user.upsert({
  where: { email: 'alice@example.com' },
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice Updated' },
})
```

**Prisma Next:**
```typescript
const user = await db.users.upsert({
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice Updated' },
})
```

---

### Batch Create

**Prisma ORM:**
```typescript
// createMany — returns count only
const { count } = await prisma.user.createMany({
  data: [
    { email: 'a@example.com', name: 'A' },
    { email: 'b@example.com', name: 'B' },
  ],
})

// createManyAndReturn — returns rows (Postgres/CockroachDB/SQLite only)
const users = await prisma.user.createManyAndReturn({
  data: [
    { email: 'a@example.com', name: 'A' },
    { email: 'b@example.com', name: 'B' },
  ],
})
```

**Prisma Next:**
```typescript
// Return created rows (streamable) — works on all targets
const users = await db.users.createAll([
  { email: 'a@example.com', name: 'A' },
  { email: 'b@example.com', name: 'B' },
])

// Or just the count
const count = await db.users.createCount([
  { email: 'a@example.com', name: 'A' },
  { email: 'b@example.com', name: 'B' },
])
```

Prisma ORM's `createManyAndReturn` only works on Postgres, CockroachDB, and SQLite (targets with `RETURNING`). Same for Prisma Next's `createAll` — it requires the `returning` capability. On targets without it (e.g. MySQL), use `createCount` (works everywhere). The ORM client deliberately does not attempt multi-step fallbacks, which would be fragile for views, keyless tables, and concurrent workloads.

---

### Nested Creates

**Prisma ORM:**
```typescript
const user = await prisma.user.create({
  data: {
    name: 'Alice',
    email: 'alice@example.com',
    posts: {
      create: [
        { title: 'First Post' },
        { title: 'Second Post' },
      ],
    },
  },
})
```

**Prisma Next:**
```typescript
const user = await db.users.create({
  name: 'Alice',
  email: 'alice@example.com',
  posts: p => p.create([
    { title: 'First Post' },
    { title: 'Second Post' },
  ]),
})
```

Prisma ORM uses `{ create: [...] }` objects on relation fields. Prisma Next uses callbacks: the relation field receives a typed `RelationMutator` and the operation name is a method call. This provides IDE autocompletion on the available operations and is consistent with the callback pattern used everywhere else in the API (`where()`, `include()`, `orderBy()`).

---

### Connect (Nested)

**Prisma ORM:**
```typescript
const post = await prisma.post.create({
  data: {
    title: 'New Post',
    author: { connect: { id: authorId } },
  },
})
```

**Prisma Next:**
```typescript
const post = await db.posts.create({
  title: 'New Post',
  author: a => a.connect({ id: authorId }),
})
```

---

### Aggregations

**Prisma ORM:**
```typescript
const count = await prisma.user.count({
  where: { active: true },
})

const result = await prisma.order.aggregate({
  _sum: { amount: true },
  _avg: { amount: true },
  where: { status: 'completed' },
})
// result._sum.amount, result._avg.amount
```

**Prisma Next:**
```typescript
const { count } = await db.users
  .where(u => u.active.eq(true))
  .aggregate(a => ({ count: a.count() }))

const result = await db.orders
  .where(o => o.status.eq('completed'))
  .aggregate(a => ({
    total: a.sum('amount'),
    avg: a.avg('amount'),
  }))
// result.total, result.avg
```

Relational aggregation in parallel with loading the same relationship with different filters:

```typescript
await db.post
  .include('comments', c => c.combine({
    totalCount: c.count()
    approved: c.where({ approved: true }),
  }))
  .select('id', 'title')
  .all()

// result: Array<{
//   id: number,
//   title: string,
//   comments: {
//     totalCount: number,
//     approved: Comment[],
//   }
// }>
```

Prisma ORM bundles aggregations into a single `aggregate()` call with `_sum`, `_avg` etc. Prisma Next uses a single `aggregate()` terminal that can compute multiple metrics in a single round-trip.

---

### GroupBy

**Prisma ORM:**
```typescript
const result = await prisma.user.groupBy({
  by: ['role'],
  _count: true,
  having: {
    role: { _count: { gt: 5 } },
  },
})
// result: Array<{ role: string; _count: number }>
```

**Prisma Next:**
```typescript
const result = await db.users
  .groupBy('role')
  .having(h => h.count().gt(5))
  .aggregate(a => ({ count: a.count() }))
// result: Array<{ role: string; count: number }>
```

---

## 2. What Prisma Next Can Express That Prisma ORM Cannot

### Streaming Results

Prisma ORM always collects results into an array in memory before returning.

```typescript
// Prisma ORM — no streaming, entire result set loaded into memory
const users = await prisma.user.findMany() // User[]

// Prisma Next — stream rows as they arrive from the database
for await (const user of db.users.all()) {
  process.stdout.write(JSON.stringify(user) + '\n')
}
```

This matters for large result sets: Prisma Next can process millions of rows without holding them all in memory.

---

### Composable, Reusable Query Fragments

In Prisma ORM, queries are single-shot argument objects. Building queries incrementally or reusing parts across different queries requires manual object spreading. In Prisma Next, every method returns a new immutable Collection that can be stored, shared, and composed.

```typescript
// Prisma ORM — manual object construction and spreading
const baseWhere = { active: true, role: 'admin' as const }

const recentAdmins = await prisma.user.findMany({
  where: { ...baseWhere, createdAt: { gte: lastWeek } },
  orderBy: { createdAt: 'desc' },
  take: 10,
})

const adminCount = await prisma.user.count({
  where: baseWhere,
})

// Prisma Next — store and derive from base collections
const admins = db.users.where({ role: 'admin', active: true })

const recentAdmins = await admins
  .where(u => u.createdAt.gte(lastWeek))
  .orderBy(u => u.createdAt.desc())
  .take(10)
  .all()

const { count: adminCount } = await admins.aggregate(a => ({ count: a.count() }))
```

---

### Custom Collections with Domain Methods

Prisma ORM has no built-in concept of domain-specific query methods. Extensions (`$extends`) can add model-level methods, but they don't compose with filters.

```typescript
// Prisma ORM — client extensions (limited composability)
const prisma = new PrismaClient().$extends({
  model: {
    user: {
      async findAdmins() {
        return prisma.user.findMany({ where: { role: 'admin' } })
      },
    },
  },
})

await prisma.user.findAdmins()
// Can't chain further: .where(...), .orderBy(...), .take(...) etc.

// Prisma Next — custom collection with fully composable domain methods
class UserCollection extends Collection<Contract, 'User'> {
  admins()   { return this.where(u => u.role.eq('admin')) }
  active()   { return this.where(u => u.active.eq(true)) }
  search(q: string) {
    return this.where(u => or(u.name.ilike(`%${q}%`), u.email.ilike(`%${q}%`)))
  }
}

// All domain methods compose with each other and with the base API
const results = await db.users
  .admins()
  .active()
  .search('alice')
  .orderBy(u => u.createdAt.desc())
  .take(10)
  .include('posts')
  .all()

// Custom methods also work inside include refinements
const usersWithRecentPosts = await db.users
  .include('posts', p => p.published().recent(5))
  .all()
```

---

### Filters as First-Class Data

In Prisma ORM, filters are plain objects with a specific shape. They can be spread, but can't be inspected, transformed, or passed through generic filter-building infrastructure.

In Prisma Next, filters are PN AST nodes (`WhereExpr`). They can be built with callbacks, constructed externally, composed with `and`/`or`/`not`, or even serialized and sent over a wire. `where()`/`first()` accept either a shorthand filter object or a callback that returns `WhereExpr`.

```typescript
// Build filters programmatically from external input
function buildFilters(params: URLSearchParams): WhereExpr[] {
  const filters: WhereExpr[] = []
  if (params.has('role'))
    filters.push(/* construct WhereExpr for role */)
  if (params.has('minAge'))
    filters.push(/* construct WhereExpr for age >= minAge */)
  return filters
}

// Use externally-built AST nodes through the callback overload
const externalFilters = buildFilters(req.query)
const users = await db.users
  .where(() => and(...externalFilters))
  .all()
```

---

### select() and include() Are Complementary

In Prisma ORM, `select` and `include` are mutually exclusive at each level of nesting. You must choose one.

```typescript
// Prisma ORM — ERROR: cannot use select and include at the same level
const user = await prisma.user.findUnique({
  where: { id: 42 },
  select: { name: true, email: true },
  include: { posts: true },
  // ^ PrismaClientValidationError
})

// Prisma ORM — workaround: nest include inside select
const user = await prisma.user.findUnique({
  where: { id: 42 },
  select: { name: true, email: true, posts: true },
})

// Prisma Next — select and include compose freely
const user = await db.users
  .select('name', 'email')
  .include('posts')
  .first({ id: 42 })
// Type: { name: string; email: string; posts: PostRow[] } | null
```

---

### Callback-Based Nested Mutations

Prisma ORM uses `{ create: [...] }` / `{ connect: {...} }` wrapper objects on relation fields. These are structurally identical to data fields, making it easy to confuse operations with values in deeply nested payloads.

Prisma Next uses callbacks: each relation field receives a typed `RelationMutator`, and the operation is a method call with IDE autocompletion.

```typescript
// Prisma ORM — nested objects, hard to distinguish operations from data
const user = await prisma.user.create({
  data: {
    name: 'Alice',
    posts: {
      create: [{ title: 'Post' }],
    },
    department: {
      connect: { id: deptId },
    },
  },
})

// Prisma Next — callbacks make operations explicit
const user = await db.users.create({
  name: 'Alice',
  posts: p => p.create([{ title: 'Post' }]),
  department: d => d.connect({ id: deptId }),
})
```

---

### Type-State Safety Guardrails

Prisma ORM catches some mistakes at runtime but not at the type level. Prisma Next uses generic type-state to catch them at compile time.

```typescript
// Prisma ORM — runtime error (or silently updates all rows in some ORMs)
await prisma.user.updateMany({
  data: { active: false },
  // forgot `where` — updates ALL users
})

// Prisma Next — compile-time error
await db.users.update({ active: false })
//              ^^^^^^ Type error: update() requires where()

// Explicit whole-table intent:
await db.users.where(all).update({ active: false })
```

```typescript
// Prisma ORM — cursor without orderBy is a runtime footgun
await prisma.user.findMany({
  cursor: { id: 42 },
  // no orderBy — undefined behavior
})

// Prisma Next — compile-time error
await db.users.cursor({ id: 42 }).all()
//             ^^^^^^ Type error: cursor() requires orderBy()
```

Cursors (and other methods) should have an ergonomic and type safe way to conditionally apply them.

---

### Deeply Nested Relational Filters

Prisma ORM supports `some`/`every`/`none` but deeply nested relational filters become hard to read as objects.

```typescript
// Prisma ORM — deeply nested object
const users = await prisma.user.findMany({
  where: {
    posts: {
      some: {
        comments: {
          some: {
            approved: true,
            author: {
              role: 'moderator',
            },
          },
        },
      },
    },
  },
})

// Prisma Next — nested callbacks with IDE autocompletion at every level
const users = await db.users
  .where(u =>
    u.posts.some(p =>
      p.comments.some(c =>
        and(
          c.approved.eq(true),
          c.author.some(a => a.role.eq('moderator'))
        )
      )
    )
  )
  .all()
```

The callback style provides autocompletion for each related model's fields, whereas the object style requires remembering the nested structure.

---

### Capability-Driven Include Execution

Prisma ORM always uses a fixed query strategy per target. Prisma Next selects the optimal include strategy based on declared contract capabilities.

```typescript
// Both produce the same API call:
const users = await db.users.include('posts').all()

// But under the hood:
// — On Postgres (has lateral + jsonAgg): single query with LATERAL subquery
// — On a target without lateral: correlated subquery with json_agg
// — On a minimal target: multi-query with in-memory stitching
//
// The strategy is selected from the contract, not detected at runtime.
```

Prisma ORM has no user-visible equivalent — its query strategy is an internal implementation detail that cannot be influenced or inspected.

---

## 3. Deeply Nested Queries — Side by Side

The examples below show realistic, production-style queries with heavy nesting. These are the queries where the difference between the two API styles becomes most pronounced.

### Blog Dashboard: Users with Posts, Comments, and Tags

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany({
  where: {
    active: true,
    posts: {
      some: {
        published: true,
      },
    },
  },
  include: {
    profile: true,
    posts: {
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        comments: {
          where: { approved: true },
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
        _count: {
          select: { comments: true, likes: true },
        },
      },
    },
  },
  orderBy: { name: 'asc' },
  take: 20,
})
```

**Prisma Next:**
```typescript
const users = await db.users
  .where(u => and(
    u.active.eq(true),
    u.posts.some(p => p.published.eq(true)),
  ))
  .include('profile')
  .include('posts', p => p
    .published()
    .orderBy(post => post.createdAt.desc())
    .take(5)
    .include('tags', t => t.include('tag'))
    .include('likes', l => l.count())
    .include('comments', c => c.combine({
      approved: c
        .where(comment => comment.approved.eq(true))
        .orderBy(comment => comment.createdAt.asc())
        .include('author', a => a.select('id', 'name', 'avatar')),
      totalCount: c.count(),
    }))
  )
  .orderBy(u => u.name.asc())
  .take(20)
  .all()
```

Each `.include()` call is a self-contained, composable callback. The Prisma ORM version requires mentally tracking 6 levels of brace nesting. The Prisma Next version reads top-to-bottom, one concern per line.

---

### E-Commerce Order History: Orders with Items, Products, Reviews, and Sellers

**Prisma ORM:**
```typescript
const orders = await prisma.order.findMany({
  where: {
    userId: currentUserId,
    status: { in: ['shipped', 'delivered'] },
    createdAt: { gte: sixMonthsAgo },
  },
  include: {
    shippingAddress: true,
    items: {
      include: {
        product: {
          include: {
            category: true,
            images: {
              where: { isPrimary: true },
              take: 1,
            },
            reviews: {
              where: {
                rating: { gte: 4 },
              },
              orderBy: { createdAt: 'desc' },
              take: 3,
              include: {
                author: {
                  select: {
                    name: true,
                    avatar: true,
                  },
                },
              },
            },
            seller: {
              include: {
                rating: true,
                badges: {
                  where: { active: true },
                },
              },
            },
          },
        },
      },
    },
    payment: {
      select: {
        method: true,
        last4: true,
        status: true,
      },
    },
  },
  orderBy: { createdAt: 'desc' },
  take: 10,
})
```

**Prisma Next:**
```typescript
const orders = await db.orders
  .where(o => and(
    o.userId.eq(currentUserId),
    o.status.in(['shipped', 'delivered']),
    o.createdAt.gte(sixMonthsAgo),
  ))
  .include('shippingAddress')
  .include('items', item => item
    .include('product', prod => prod
      .include('category')
      .include('images', img => img.where({ isPrimary: true }).take(1))
      .include('reviews', rev => rev
        .where(r => r.rating.gte(4))
        .orderBy(r => r.createdAt.desc())
        .take(3)
        .include('author', a => a.select('name', 'avatar'))
      )
      .include('seller', s => s
        .include('rating')
        .include('badges', b => b.where({ active: true }))
      )
    )
  )
  .include('payment', p => p.select('method', 'last4', 'status'))
  .orderBy(o => o.createdAt.desc())
  .take(10)
  .all()
```

The Prisma ORM version is 50+ lines of nested braces where `include`, `where`, `select`, and `orderBy` all coexist at the same object level, making it easy to confuse which option belongs to which model. The Prisma Next version uses a consistent pattern at every level: the callback receives a collection for the related model, and you chain the same methods you'd use at the top level.

---

### Nested Create: Organization with Departments, Teams, and Members

**Prisma ORM:**
```typescript
const org = await prisma.organization.create({
  data: {
    name: 'Acme Corp',
    plan: 'enterprise',
    owner: { connect: { id: founderId } },
    departments: {
      create: [
        {
          name: 'Engineering',
          teams: {
            create: [
              {
                name: 'Platform',
                members: {
                  create: [
                    { user: { connect: { email: 'alice@acme.com' } }, role: 'lead' },
                    { user: { connect: { email: 'bob@acme.com' } }, role: 'member' },
                  ],
                },
              },
              {
                name: 'Product',
                members: {
                  create: [
                    { user: { connect: { email: 'charlie@acme.com' } }, role: 'lead' },
                  ],
                },
              },
            ],
          },
        },
        {
          name: 'Marketing',
          teams: {
            create: [
              {
                name: 'Growth',
                members: {
                  create: [
                    { user: { connect: { email: 'diana@acme.com' } }, role: 'lead' },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
  include: {
    departments: {
      include: {
        teams: {
          include: {
            members: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    },
  },
})
```

**Prisma Next:**
```typescript
const org = await db.organizations
  .create({
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
  })
  .include('departments', d => d
    .include('teams', t => t
      .include('members', m => m.include('user'))
    )
  )
```

The Prisma ORM version uses `{ create: [...] }` and `{ connect: {...} }` wrapper objects at every relation level, which are easy to confuse with actual data fields. The Prisma Next version uses callbacks: each relation field receives a typed mutator, and the operation (`create`, `connect`) is a method call with IDE autocompletion. Additional differences:
- No `data:` wrapper in Prisma Next
- The `include` (what to return) is separated from the mutation payload, making each concern clearer
- In Prisma ORM, the `include` block at the end repeats the nesting structure of `data`, duplicating the hierarchy

---

### Complex Relational Filter: Multi-Level Existence Checks

**Prisma ORM:**
```typescript
// Find companies where at least one department has a team
// whose lead has published a post with more than 100 likes
const companies = await prisma.company.findMany({
  where: {
    active: true,
    departments: {
      some: {
        teams: {
          some: {
            members: {
              some: {
                role: 'lead',
                user: {
                  posts: {
                    some: {
                      published: true,
                      likes: {
                        some: {},
                      },
                      _count: {
                        likes: { gte: 100 },  // Note: _count in where is not actually valid Prisma ORM
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
})
```

**Prisma Next:**
```typescript
const companies = await db.companies
  .where(c => and(
    c.active.eq(true),
    c.departments.some(d =>
      d.teams.some(t =>
        t.members.some(m => and(
          m.role.eq('lead'),
          m.user.some(u =>
            u.posts.some(p => and(
              p.published.eq(true),
              p.likes.count().gte(100),
            ))
          ),
        ))
      )
    ),
  ))
  .all()
```

At 5 levels of relational nesting, the Prisma ORM object syntax becomes a wall of braces where it's easy to lose track of which `some` belongs to which relation. The callback style makes each level's scope explicit through function parameters (`c`, `d`, `t`, `m`, `u`, `p`), and the IDE provides autocompletion at every level.

---

## Open Questions from Q&A Session (Feb 17)

These items were raised during team review and haven't been fully incorporated into the spec yet.

- **Generic reusable filters:** How to build filters that work on any model with a given field (e.g. any model with an `email` field).
- **ParadeDB / extension operators:** Build a `WhereExpr` node containing a raw SQL operator added by the extension.
- **`omit` as a complement to `select`:** Rather than a separate method, use `select(schema.users.fields.omit('password'))` to keep composition clean.
- **Conditional method application:** Cursors and other methods need an ergonomic, type-safe way to be conditionally applied.
- **Consider models:** Explore what typed model instances could look like beyond plain row objects.
