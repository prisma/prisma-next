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

See [`projects/pothos-prisma-next/workarounds.md`](../../projects/pothos-prisma-next/workarounds.md) for the full log of workarounds applied and load-bearing decisions made along the way, including a detailed walkthrough of the orm-client nested-stitch FK gap that needed fixing in the walker.

## What doesn't work properly

Functional everywhere; observable rough edges to call out:

- **Every relation level is its own SQL statement.** Verified to 4 levels (`users → posts → comments → author`) — correct results, but the demo response's `extensions.prismaNext.executions` shows N+1 query counts: 1 outer SELECT plus one per relation level rather than a single nested-include statement. Even on Postgres (`LATERAL` + `json_agg`) and SQLite (`json_group_array`), the orm-client falls back to the multi-query strategy whenever the include shape is depth-2+ or uses combine/scalar. Cause: prisma-next gaps detailed below (Issue A, Issue B). The headline `drafts`/`publishedPosts`/`postCount` query is 4 statements; could be 1.
- **`t.relation` outside `t.prismaField` throws.** Plugin-scope choice (D-2): rather than a silent lazy-load N+1, the resolver fails fast with a message naming the field path. Means a v2 plugin needs a deliberate dataloader integration before lifting the restriction.

## Prisma-next limitations the plugin is bumping into

What a real v2 plugin needs from prisma-next, surfaced by this demo. Each item links to the more detailed walkthrough.

### orm-client: nested includes fall back to multi-query

**Issue A — `hasNestedIncludes` short-circuit.** Detail: [`projects/pothos-prisma-next/issues.md#issue-a--hasnestedincludes-short-circuit`](../../projects/pothos-prisma-next/issues.md). The dispatcher in `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` short-circuits any include with its own `.includes` to multi-query, even when capabilities allow a single-statement plan. The single-query SQL emitter (`buildIncludeChildRowsSelect` in `query-plan-select.ts`) is depth-1: it reads `childState.selectedFields`/`.orderBy`/`.limit` but ignores `childState.includes`. Fix is recursive emission + a path-prefixed alias namespace + recursive result unwrap. Estimated 1–2 weeks plus an ADR (codec-through-JSON for grandchildren, planner-cost heuristic for nested LATERAL on Postgres).

### orm-client: combine + scalar always falls back

**Issue B — `hasComplexIncludeDescriptors` short-circuit.** Detail: [`projects/pothos-prisma-next/issues.md#issue-b--hascomplexincludedescriptors-short-circuit-combine--scalar`](../../projects/pothos-prisma-next/issues.md). The same dispatcher routes any include carrying a `scalar` (count/sum/avg/min/max) or `combine({...})` to multi-query. The single-query SQL emitter explicitly throws on these shapes. Fix is to emit aggregate subqueries (or LATERAL derived tables) for scalars, and a `json_object(...)` projection per combine branch. Estimated 3–7 days plus an ADR — the real risk is aggregation-semantics divergence (`pg/numeric@1` precision, custom codecs, NULL handling) when moving reductions from JS into SQL.

The demo's drafts/publishedPosts/postCount query is the canonical example: today it emits 4 statements (1 outer + 3 branches); could be 1.

### orm-client: nested-stitch FK augmentation is depth-1 only

**W-1.** Detail in [`projects/pothos-prisma-next/workarounds.md#w-1-orm-client-recursive-nested-stitch-foreign-key-gap`](../../projects/pothos-prisma-next/workarounds.md#w-1-orm-client-recursive-nested-stitch-foreign-key-gap). On the multi-query path, `resolveRowsByParent` (`collection-dispatch.ts:368-417`) only auto-augments the immediate FK column needed to join children to their direct parent. It does not augment FK columns the children themselves need to join to *their* children. Result: a 3+ level deep multi-query stitch silently drops the next level (returns `null` for the grandchild relation). The plugin works around this in `auto-include.ts` by collecting every nested relation's `localFields` and adding them to the parent's `.select(...)`. Once Issue A lands, this becomes moot for the single-query path; the multi-query path still has the bug as a fallback.

### sqlite adapter: no `booleanColumn` / `sqlite/bool@1` codec

The sqlite adapter exposes `text/integer/real/blob/datetime/json/bigint` columns (`packages/3-targets/6-adapters/sqlite/src/exports/column-types.ts`) but no boolean. Postgres has `boolColumn` + `pg/bool@1`; sqlite would need the equivalent (storing as INTEGER 0/1 with a codec that decodes to TS `boolean`). Today the demo's `Post.published` is declared `integerColumn`, so the GraphQL surface is `Int!` (`t.exposeInt('published')` returns 0 or 1). With a boolean codec it would be `t.exposeBoolean('published')` and serialise as a real `Boolean!`. The plugin needs no changes — this is purely a sqlite-adapter coverage gap.

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
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    posts: t.relation('posts'),
    // Fluent refiner — same shape `Collection.include('rel', refineFn)` exposes.
    // `rel` is contract-typed, so `rel.where({...})` autocompletes against
    // Post's columns; misspellings are compile errors.
    drafts: t.relation('posts', { query: (rel) => rel.where({ published: 0 }) }),
    publishedPosts: t.relation('posts', { query: (rel) => rel.where({ published: 1 }) }),
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
