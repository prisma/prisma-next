---
name: prefer-prisma-orm-features
description: >-
  Use when writing Prisma Client query code that fetches or modifies related
  data, runs multi-step dependent operations, or filters by relations. Teaches
  the agent to prefer Prisma's built-in ORM features — `include`/`select` for
  single round-trips, nested writes (`create`/`connect`/`update`) inside
  `create`/`update`/`upsert`, `$transaction` for multi-step operations, and
  relation filters (`some`/`every`/`none`/`is`) — over fetching data and
  reimplementing joins, writes, transactions, or filtering in application code.
  The goal is fewer database round-trips, correctness, and end-to-end type
  safety.
---

# Prefer Prisma ORM features over reimplementing them

Prisma Client is an ORM: it already knows your relations, can fetch them in one round-trip, write parent and child records together, run transactions, and filter by related rows at the database level. When you find yourself querying, then looping, then mutating, then filtering in application code, stop — Prisma almost always has a built-in feature that does it in one typed call. Reach for the ORM feature first; the result is fewer round-trips, atomic correctness, and a return type that already matches what you need.

The examples below share this minimal schema so the relations are explicit:

```prisma
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
  posts Post[]
}

model Post {
  id        Int       @id @default(autoincrement())
  title     String
  published Boolean   @default(false)
  authorId  Int
  author    User      @relation(fields: [authorId], references: [id])
  comments  Comment[]
}

model Comment {
  id     Int    @id @default(autoincrement())
  text   String
  postId Int
  post   Post   @relation(fields: [postId], references: [id])
}
```

## Fetch relations in a single round-trip

Pull related data in ONE query using `include` (or `select` with a nested `select`). Never fire one query per relation and stitch the results together in application code — that is the N+1 pattern.

Anti-pattern (one query per user, then one query per user's posts):

```ts
const users = await prisma.user.findMany()
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { authorId: user.id } })
  user.posts = posts
}
```

Recommended:

```ts
const users = await prisma.user.findMany({
  include: { posts: true },
})
```

Why: one round-trip instead of N+1; the database performs the join and Prisma types the result to include the `posts` relation.

## Applies to writes, not just reads

Reads (`findMany`, `findUnique`, `findFirst`) use `include`/`select` to pull relations in one trip. Writes (`create`, `update`, `upsert`, `createMany`) take nested `create`/`connect`/`update` inside the same call. Don't fetch a record, mutate it in memory, and save it in a separate step — write the relation inline.

Anti-pattern (create the author, then create each post in a separate call):

```ts
const author = await prisma.user.create({ data: { email: 'a@b.c' } })
await prisma.post.create({ data: { title: 'Hello', authorId: author.id } })
await prisma.post.create({ data: { title: 'World', authorId: author.id } })
```

Recommended (one `create` with nested writes):

```ts
const author = await prisma.user.create({
  data: {
    email: 'a@b.c',
    posts: {
      create: [{ title: 'Hello' }, { title: 'World' }],
    },
  },
  include: { posts: true },
})
```

`connect` links an existing related record in a single `update`, and `update` modifies nested records in place:

```ts
// link an existing post to a user in one update
await prisma.user.update({
  where: { id: userId },
  data: { posts: { connect: { id: postId } } },
  include: { posts: true },
})

// update every comment on a post in one call
await prisma.post.update({
  where: { id: postId },
  data: { comments: { updateMany: { where: { text: { startsWith: 'TODO' } }, data: { text: 'done' } } } },
})
```

Why: parent and children are written in one operation Prisma wraps in its own transaction; the returned shape is typed and consistent, with no intermediate partial state.

## Wrap multi-step operations in `$transaction`

Use `$transaction` for operations that must commit together or roll back together. There are two forms: a sequential array for independent operations, and an interactive callback when a later step depends on a value produced by an earlier one.

Anti-pattern (dependent writes with no transaction — a failed second insert leaves an orphaned post):

```ts
const post = await prisma.post.create({ data: { title: 'Hello', authorId: userId } })
await prisma.comment.create({ data: { text: 'First!', postId: post.id } })
```

Recommended — array form for independent operations (each element is a standalone Prisma promise):

```ts
const [published, unpublished] = await prisma.$transaction([
  prisma.post.update({ where: { id: 1 }, data: { published: true } }),
  prisma.post.update({ where: { id: 2 }, data: { published: false } }),
])
```

Recommended — interactive form for dependent operations (the second insert needs `created.id` from the first):

```ts
const post = await prisma.$transaction(async (tx) => {
  const created = await tx.post.create({ data: { title: 'Hello', authorId: userId } })
  await tx.comment.create({ data: { text: 'First!', postId: created.id } })
  return created
})
```

Why: both writes commit together or roll back together. The array form is concise but cannot reference results between elements — when a step needs a value from an earlier step, use the interactive form and throw to abort the whole transaction.

## Filter by relations at the database level

Use the relation filters `some`, `every`, `none`, and `is`/`isNot` in `where` to filter by related records at the database level. Don't fetch a broad set and filter it down in application code.

Anti-pattern (fetch every user with their posts, then filter in JS for "has a published post"):

```ts
const users = await prisma.user.findMany({ include: { posts: true } })
const active = users.filter((u) => u.posts.some((p) => p.published))
```

Recommended:

```ts
const active = await prisma.user.findMany({
  where: { posts: { some: { published: true } } },
})
```

The four relation filters:

- `some` — at least one related record matches.
- `every` — all related records match (an empty relation also satisfies this).
- `none` — no related record matches.
- `is` / `isNot` — a to-one relation matches (or does not match) a condition.

```ts
// posts whose author has a specific email (to-one relation, use `is`)
const posts = await prisma.post.findMany({
  where: { author: { is: { email: 'a@b.c' } } },
})
```

Why: the database filters, so you transfer only matching rows and the result type already reflects the filter.

## Prefer `select` to limit fields

When you don't need every column, use `select` to return only the fields you use. Less data crosses the wire and the return type narrows to exactly those fields.

Anti-pattern (returns `id`, `email`, and `name` for every user even though only `email` is used):

```ts
const users = await prisma.user.findMany()
const emails = users.map((u) => u.email)
```

Recommended:

```ts
const users = await prisma.user.findMany({ select: { email: true } })
const emails = users.map((u) => u.email)
```

`select` and `include` are mutually exclusive at the top level. To narrow fields and still pull a relation, nest a `select` inside the relation within a top-level `select`:

```ts
const users = await prisma.user.findMany({
  select: { email: true, posts: { select: { title: true } } },
})
```

Why: smaller payloads and a result type that contains only what you asked for, surfaced for you by Prisma's generated types.
