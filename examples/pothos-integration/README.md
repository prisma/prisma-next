# pothos-integration (demo)

> **Throwaway demo.** Built in a few hours to validate the integration shape with the [Pothos](https://pothos-graphql.dev/) author. Not production-grade. Not packaged for npm. Path-of-least-resistance code throughout.

A working `@pothos/plugin-prisma-next`-style plugin built against the prisma-next ORM client and a `graphql-yoga` server. Demonstrates that Pothos's auto-include pattern (one nested GraphQL query → one nested SQL plan) ports cleanly onto prisma-next's contract + Collection API.

## What's in scope

- `builder.prismaObject('User', { fields: t => ({...}) })` — register a GraphQL type bound to a prisma-next contract model.
- `t.relation('posts')` — list / single relation field; auto-included by the walker.
- `t.relation('drafts', { query: { where: ... } })` — multiple GraphQL fields backed by the same prisma-next relation, with different filters. Resolves in a single nested-include via prisma-next's `combine`.
- `t.relationCount('posts')` — peer `Int!` field exposing the count of related rows. Emitted as a `count()` branch in the same combine block as the rows.
- `t.prismaField({ type: 'User', resolve: (collection, ...) => ... })` — entry-point field that hands the user resolver a Collection pre-prepared with the auto-include selection. The user chains `.where(...).all().firstOrThrow()` themselves.
- Per-request SQL execution capture surfaced to GraphQL response `extensions.prismaNext` (mirroring what Pothos+Prisma users do via Prisma's `$on('query')` hook).

## What's deliberately not implemented

This is a single-day demo. Out of scope for v1:

- Relay (`prismaConnection`, `relatedConnection`).
- Type variants (`prismaInterface`, `prismaNode`).
- Polymorphism / discriminators.
- Indirect / M:N relations through join tables.
- Cursor pagination on relations.
- Lazy-load fallback when `t.relation` is reached from a parent that wasn't loaded by `t.prismaField` (the resolver throws a clear error instead — see below).
- `select`-mode for types (Pothos-prisma's narrow-shape feature).
- Value objects on prisma-next models.
- Codec-aware exposes (custom GraphQL scalar mapping per codec).
- Per-tick batched `findUnique` coalescer (Pothos's dataloader story handles this).
- Capability gating at schema-build time.
- TypeScript generator (types derive directly from `Contract`).
- Type tests / automated regression coverage.
- Per-model row inference (parent shapes are `Record<string, unknown>` — every field uses `t.field({ type, resolve })` instead of `t.exposeID/String/...`).

See [`projects/pothos-prisma-next/workarounds.md`](../../projects/pothos-prisma-next/workarounds.md) for the full log of workarounds applied and load-bearing decisions made along the way, including a detailed walkthrough of the orm-client nested-stitch FK gap that needed fixing in the walker.

## Run it

```bash
# (one-time) generate the contract artefacts and seed the sqlite db
pnpm --filter pothos-integration emit
pnpm --filter pothos-integration db:init
pnpm --filter pothos-integration seed

# boot the GraphQL server
pnpm --filter pothos-integration dev

# open the playground at http://localhost:4000/graphql
```

GraphiQL lets you type queries interactively. Each response includes `extensions.prismaNext.executions[]` listing every SQL statement issued, with params, rowCount, and latencyMs. Server stdout also prints a one-line `request executed N SQL queries` summary per request.

## Headline queries

The canonical Pothos auto-include flow — one GraphQL query, one nested SQL plan:

```graphql
{
  users {
    id
    firstName
    posts {
      id
      title
      comments {
        id
        body
        author { firstName }
      }
    }
  }
}
```

Resolves in 4 SQL queries (one per relation level: users → posts → comments → users-as-authors).

The drafts/posts/postCount headline differentiator — multiple GraphQL fields backed by the same prisma-next `posts` relation, plus a peer count:

```graphql
{
  users {
    id firstName
    drafts { id title }            # t.relation('posts', { query: { where: { published: 0 } } })
    publishedPosts { id title }    # t.relation('posts', { query: { where: { published: 1 } } })
    postCount                      # t.relationCount('posts')
  }
}
```

Returns flat keys (`drafts`, `publishedPosts`, `postCount`) on each user. The walker emits one nested `.include('posts', p => p.combine({ drafts, publishedPosts, postCount: p.count() }))`. The plugin's `wrapResolve` reshape lifts the combine branches onto the parent so resolvers always see flat shapes — they don't have to know combine was used under the hood.

## Wiring (for the curious)

```ts
// src/builder.ts
const builder = new SchemaBuilder<{
  Context: AppContext;
  PrismaNextContract: Contract;
}>({
  plugins: [PrismaNextPlugin],
  prismaNext: {
    contract,                          // typed Contract from the contract.ts authoring DSL
    db: createOrmClient(runtime),      // orm({ runtime, context }) per-model accessor
  },
});
```

```ts
// src/schema.ts (truncated)
builder.prismaObject('User', {
  fields: (t) => ({
    id: t.field({ type: 'ID', resolve: (parent) => (parent as Record<string, unknown>).id }),
    firstName: t.field({ type: 'String', resolve: (parent) => (parent as Record<string, unknown>).firstName }),
    posts: t.relation('posts'),
    drafts: t.relation('posts', { query: { where: { published: 0 } } }),
    publishedPosts: t.relation('posts', { query: { where: { published: 1 } } }),
    postCount: t.relationCount('posts'),
  }),
});

builder.queryType({
  fields: (t) => ({
    userById: t.prismaField({
      type: 'User',
      args: { id: t.arg.string({ required: true }) },
      resolve: (collection, _root, args) =>
        collection.where({ id: args.id }).all().firstOrThrow(),
    }),
  }),
});
```

## Fallback error

If a `t.relation` field is reached from a parent that wasn't loaded by `t.prismaField`, the resolver throws:

```
[pothos-prisma-next] Relation 'User.posts' was reached from a parent not loaded by t.prismaField.
Use t.prismaField as the entry point so the auto-include walker can preload this relation.
Lazy fallback loading is not supported in this demo.
```

Rather than silently issuing a fallback `findUnique` and risking N+1, the demo refuses. Pothos's existing dataloader integrations are the right place to add batching when a v2 needs lazy-load support.

## Source layout

```
src/
├── plugin/
│   ├── index.ts                         BasePlugin with wrapResolve dispatch
│   ├── global-types.ts                  Pothos type augmentations (declare module)
│   ├── types.ts                         Extension-key constants + plugin options types
│   ├── schema-builder.ts                builder.prismaObject(...)
│   ├── prisma-object-field-builder.ts   PrismaNextObjectFieldBuilder (with t.relation/t.relationCount)
│   ├── field-builder.ts                 t.prismaField (on RootFieldBuilder.prototype)
│   ├── auto-include.ts                  GraphQL info → Collection chain + reshape walker
│   └── ref-cache.ts                     WeakMap<builder, Map<modelName, ref>> dedupe
├── prisma/
│   ├── contract.json                    emitted
│   ├── contract.d.ts                    emitted
│   ├── contract.ts                      authoring DSL
│   ├── db.ts                            sqlite runtime + capture middleware
│   ├── orm.ts                           createOrmClient(runtime)
│   └── capture.ts                       per-request SqlMiddleware + AsyncLocalStorage
├── builder.ts                           Pothos SchemaBuilder factory
├── schema.ts                            demo GraphQL schema (User/Post/Comment)
└── server.ts                            graphql-yoga + capture plugin
```
