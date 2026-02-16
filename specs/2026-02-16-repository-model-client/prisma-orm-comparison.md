# Prisma ORM vs Prisma Next — API Comparison

This document compares Prisma ORM's `PrismaClient` API with the Prisma Next ORM Client API specified in `spec.md`. Section 1 covers side-by-side equivalents. Section 2 covers capabilities unique to Prisma Next.

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

### findMany

**Prisma ORM:**
```typescript
const users = await prisma.user.findMany()
```

**Prisma Next:**
```typescript
const users = await db.users.findMany()
```

Both return all records. In Prisma Next, `findMany()` returns an `AsyncIterableResult` that is both async-iterable (for streaming) and thenable (so `await` collects into an array).

---

### findFirst

**Prisma ORM:**
```typescript
const user = await prisma.user.findFirst({
  where: { email: 'alice@example.com' },
})
```

**Prisma Next:**
```typescript
const user = await db.users
  .where({ email: 'alice@example.com' })
  .first()
```

Both return `User | null`.

---

### findUnique

**Prisma ORM:**
```typescript
const user = await prisma.user.unique({
  where: { email: 'alice@example.com' },
})
```

**Prisma Next:**
```typescript
const user = await db.users.unique({ email: 'alice@example.com' })
```

Both derive the allowed unique criteria from the schema/contract. Prisma Next passes the criterion directly as an argument rather than wrapping it in `{ where: ... }`.

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
const admins = await db.users.where({ role: 'admin' }).findMany()

// Callback with typed accessor
const admins = await db.users.where(u => u.role.eq('admin')).findMany()
```

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
  .findMany()
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
  .findMany()
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
  .findMany()
```

Same naming (`some`, `every`, `none`). Prisma Next uses callbacks instead of nested objects, which enables IDE autocompletion on the related model's fields.

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
const users = await db.users.include('posts').findMany()
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
  .findMany()
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
  .findMany()
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
const users = await db.users.select('id', 'email').findMany()
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
  .findMany()
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
  .findMany()
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
  .findMany()
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
const users = await db.users.distinct('role').findMany()

// Or DISTINCT ON (Postgres) with required ordering:
const users = await db.users
  .orderBy(u => u.createdAt.desc())
  .distinctOn('email')
  .findMany()
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
const user = await prisma.user.update({
  where: { id: 42 },
  data: { name: 'Alice Updated' },
})
```

**Prisma Next:**
```typescript
const user = await db.users
  .where(u => u.id.eq(42))
  .update({ name: 'Alice Updated' })
```

Prisma ORM requires `where` inside the argument object. Prisma Next uses the same chainable `.where()` as reads.

---

### Delete

**Prisma ORM:**
```typescript
const user = await prisma.user.delete({
  where: { id: 42 },
})
```

**Prisma Next:**
```typescript
await db.users.where(u => u.id.eq(42)).delete()
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

### Batch Operations

**Prisma ORM:**
```typescript
const count = await prisma.user.createMany({
  data: [
    { email: 'a@example.com', name: 'A' },
    { email: 'b@example.com', name: 'B' },
  ],
})

await prisma.user.updateMany({
  where: { role: 'guest' },
  data: { active: false },
})

await prisma.user.deleteMany({
  where: { active: false },
})
```

**Prisma Next:**
```typescript
const count = await db.users.createMany([
  { email: 'a@example.com', name: 'A' },
  { email: 'b@example.com', name: 'B' },
])

await db.users.where(u => u.role.eq('guest')).updateMany({ active: false })

await db.users.where(u => u.active.eq(false)).deleteMany()
```

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
  posts: {
    create: [
      { title: 'First Post' },
      { title: 'Second Post' },
    ],
  },
})
```

Nearly identical. Prisma Next drops the `data:` wrapper.

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
  author: { connect: { id: authorId } },
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
const count = await db.users.where(u => u.active.eq(true)).count()

const total = await db.orders.where(o => o.status.eq('completed')).sum('amount')
const avg = await db.orders.where(o => o.status.eq('completed')).avg('amount')
```

Prisma ORM bundles aggregations into a single `aggregate()` call with `_sum`, `_avg` etc. Prisma Next has individual methods that return scalars directly.

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
  .having(g => g.count().gt(5))
  .count()
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
for await (const user of db.users.findMany()) {
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
  .findMany()

const adminCount = await admins.count()
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
  .findMany()

// Custom methods also work inside include refinements
const usersWithRecentPosts = await db.users
  .include('posts', p => p.published().recent(5))
  .findMany()
```

---

### Filters as First-Class Data

In Prisma ORM, filters are plain objects with a specific shape. They can be spread, but can't be inspected, transformed, or passed through generic filter-building infrastructure.

In Prisma Next, filters are PN AST nodes (`WhereExpr`). They can be built with callbacks, constructed externally, composed with `and`/`or`/`not`, or even serialized and sent over a wire.

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

// Use externally-built AST nodes directly
const externalFilters = buildFilters(req.query)
const users = await db.users
  .where(and(...externalFilters))
  .findMany()
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
  .findUnique({ id: 42 })
// Type: { name: string; email: string; posts: PostRow[] } | null
```

---

### Fluent Chain Nested Mutations

Prisma ORM supports nested writes inside `create`/`update` payloads, but navigating from a parent to a child collection for a targeted mutation requires separate queries.

```typescript
// Prisma ORM — must look up the parent, then create on the child model
const post = await prisma.post.findUnique({ where: { id: postId } })
if (!post) throw new Error('not found')
await prisma.comment.create({
  data: { body: 'Great post!', postId: post.id },
})

// Prisma Next — fluent chain navigates from parent to child
await db.posts
  .findUnique({ id: postId })
  .comments
  .create({ body: 'Great post!' })
```

The FK value is inferred from the contract relationship, so you never manually set `postId`.

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
await db.users.where(all()).update({ active: false })
```

```typescript
// Prisma ORM — cursor without orderBy is a runtime footgun
await prisma.user.findMany({
  cursor: { id: 42 },
  // no orderBy — undefined behavior
})

// Prisma Next — compile-time error
await db.users.cursor({ id: 42 }).findMany()
//             ^^^^^^ Type error: cursor() requires orderBy()
```

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
  .findMany()
```

The callback style provides autocompletion for each related model's fields, whereas the object style requires remembering the nested structure.

---

### Capability-Driven Include Execution

Prisma ORM always uses a fixed query strategy per target. Prisma Next selects the optimal include strategy based on declared contract capabilities.

```typescript
// Both produce the same API call:
const users = await db.users.include('posts').findMany()

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
    .include('comments', c => c
      .where(comment => comment.approved.eq(true))
      .orderBy(comment => comment.createdAt.asc())
      .include('author', a => a.select('id', 'name', 'avatar'))
    )
  )
  .orderBy(u => u.name.asc())
  .take(20)
  .findMany()
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
  .findMany()
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
  // better proposal
  .create(c => ({
    name: ...,
    owner: c.connect({ id: founderId }),
    departments: d => d.create([
      {
        name: 'Engineering',
        teams: t => t.create([
          name: 'Platform',
          members: m => m....
        ])
      }
    ])
  }))
  // current proposal in the spec
  .create({
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
  })
  .include('departments', d => d
    .include('teams', t => t
      .include('members', m => m.include('user'))
    )
  )
```

For nested **creates**, the payload structure is similar — both APIs need to express the same tree of records. The key differences:
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
  .findMany()
```

At 5 levels of relational nesting, the Prisma ORM object syntax becomes a wall of braces where it's easy to lose track of which `some` belongs to which relation. The callback style makes each level's scope explicit through function parameters (`c`, `d`, `t`, `m`, `u`, `p`), and the IDE provides autocompletion at every level.
