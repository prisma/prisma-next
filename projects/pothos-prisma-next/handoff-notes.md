# Handoff Notes — `@pothos/plugin-prisma-next`

For Michael Hayes (Pothos author). Written assuming you'll throw most of `examples/pothos-integration` away and start clean. These are the prisma-next-isms that surfaced while building it — the parts worth carrying forward into a real plugin even if the rest of the implementation isn't.

The demo lives at `examples/pothos-integration/` in the prisma-next repo. The full workaround / decision log is at `projects/pothos-prisma-next/workarounds.md`; orm-client follow-ups in `projects/pothos-prisma-next/issues.md`.

## TL;DR

Three things matter most:

1. **`DefaultModelRow<TContract, ModelName>` + relation metadata types** — the contract-derived typing primitives. A v2 plugin doesn't need a generator; the typed `Contract` carries everything.
2. **`Collection.include('rel', refineFn)`'s callback shape, mirrored as `t.relation`'s `query`** — proof that the prisma-next API ports naturally as a Pothos `query` shape, just fluent instead of literal.
3. **`combine` + sibling-grouping in the walker** — the answer for `drafts` / `publishedPosts` / `postCount` in one nested SQL plan. Plugin-prisma doesn't have this because Prisma's input-tree doesn't.

## A. Contract-first typing

prisma-next has **no codegen step that writes `Prisma.User` types into `node_modules`**. The contract — `contract.json` plus the matching emitted `contract.d.ts` — *is* the type source. Everything the plugin needs is computed from the user's `Contract` type at TS-evaluation time.

What this means for a v2 plugin:

### `DefaultModelRow<TContract, ModelName>`

From `@prisma-next/sql-orm-client`. Maps `Contract['models'][M]['fields']` to the decoded row — `id: string`, `firstName: string`, `published: number`, `createdAt: Date`. Analogue of plugin-prisma's `Prisma.UserGetPayload`. Use it as `ParentShape` on `prismaObject`'s ref so `t.exposeID('id')` typechecks.

The single move that unblocks everything is the `RowFor` helper in `examples/pothos-integration/src/plugin/global-types.ts`:

```ts
type RowFor<Types extends SchemaTypes, ModelName extends string> =
  Types['PrismaNextContract'] extends Contract<SqlStorage>
    ? DefaultModelRow<Types['PrismaNextContract'], ModelName>
    : Record<string, unknown>;
```

Plumb `RowFor<Types, ModelName>` into `ObjectFieldBuilder`'s `ParentShape` slot via `prismaObject`'s `fields(t)` callback type, and Pothos's existing `CompatibleTypes` constraint resolves to actual field names instead of `never`. No plugin-side `expose*` overrides needed.

### `RelationNames<TContract, ModelName>` and `RelatedModelName<TContract, ModelName, RelName>`

Relation metadata at the type level. Used in the demo to:

- Constrain `t.relation('postss')` to a real compile error (`name` is `keyof TContract['models'][M]['relations']`).
- Look up the related model's row shape for the relation collection's `ParentShape`.

### `ShorthandWhereFilter<TContract, ModelName>`

Contract-typed `where` shape. Lets `query: (rel) => rel.where({ published: 0 })` autocomplete against the related model's columns and reject typos at compile time.

### Codecs are the type source, not Prisma

Each contract field has a `codecId`. The codec value carries the decoded TS type as a phantom (`TJs` on `Codec<Id, TWire, TJs, TParams, THelper>`); `ComputeColumnJsType` and `DefaultModelRow` chain through it. The chain that actually does the work:

- `packages/2-sql/4-lanes/relational-core/src/types.ts` → `ComputeColumnJsType<Col>`
- `packages/3-extensions/sql-orm-client/src/types.ts:429` → `DefaultModelRow<TContract, ModelName>`

When sqlite has no boolean codec, the row gives you `published: number` — the plugin doesn't get to "decide" the GraphQL surface, the contract does. The demo's `t.exposeInt('published')` follows this honestly; a `t.exposeBoolean` surface needs a real `sqlite/bool@1` codec (`workarounds.md` W-9).

## B. Fluent API, not literal-tree input

Plugin-prisma takes its lead from Prisma: queries are literal trees (`findMany({ where, orderBy, take })`). prisma-next is **chained method-builder**: `db.User.where(...).orderBy(...).take(...)`. The plugin needs to follow it.

### `t.relation('rel', { query })` is a refiner callback

Same shape `Collection.include('rel', refineFn)` accepts:

```ts
drafts: t.relation('posts', {
  query: (rel, args, ctx) => rel.where({ published: args.flag ? 1 : 0 }),
}),
```

`rel` is `IncludeRefinementCollection<TContract, RelatedModel, RelatedRow, …, IsToMany>`. Same parameter `.include()`'s refineFn receives. `rel.where({ wehere: 0 })` is a compile error; `rel.delete()` doesn't exist on the omitted-terminals shape. Args + ctx come typed from the field's `Args` and `Types['Context']`.

This is the single biggest API divergence from plugin-prisma. Plugin-prisma's `query: { where: { published: true } }` literal would mismatch prisma-next's surface; the literal shape is a leftover from copying plugin-prisma's surface and shouldn't appear in a v2.

The orm-client now exports `IncludeRefinementCollection`, `IncludeRefinementResult`, and `IsToManyRelation` from `@prisma-next/sql-orm-client` so a plugin can reuse the same shape `.include()` already uses.

### `combine` for sibling-aliased fields

The prisma-next primitive for "multiple GraphQL fields backed by the same relation". Demo's headline differentiator:

```ts
builder.prismaObject('User', {
  fields: (t) => ({
    posts: t.relation('posts'),
    drafts: t.relation('posts', { query: (r) => r.where({ published: 0 }) }),
    publishedPosts: t.relation('posts', { query: (r) => r.where({ published: 1 }) }),
    postCount: t.relationCount('posts'),
  }),
});
```

The walker compiles these into one nested include:

```ts
db.User.include('posts', p => p.combine({
  posts: p,                                    // plain
  drafts: p.where({ published: 0 }),           // refined branch
  publishedPosts: p.where({ published: 1 }),   // refined branch
  postCount: p.count(),                        // scalar branch
}))
```

One include, multiple branches. The `wrapResolve` reshape lifts each branch onto the parent so resolvers see flat keys (`parent.drafts`, `parent.postCount`) — they don't have to know `combine` was used under the hood.

This is *not* something plugin-prisma has because Prisma's input tree doesn't either. Worth surfacing because it's the cleanest answer for sibling-aliased relations + peer counts.

Walker implementation: `examples/pothos-integration/src/plugin/auto-include.ts` (the sibling-grouping in `collectFields` + `walkSelection`).

### `AsyncIterableResult` terminals

`db.User.where(...).all()` returns an iterator-ish thing; `.firstOrThrow()` collapses it. The `t.prismaField` resolver receives a prepared Collection and the user chains `.where(...).all().firstOrThrow()` themselves — different from `findUniqueOrThrow({ ... })`. Just needs documentation.

## C. Runtime composition

### `SqlMiddleware` from `@prisma-next/sql-runtime`

The runtime is middleware-composable. Per-request execution capture in the demo is a tiny middleware + `AsyncLocalStorage` (`examples/pothos-integration/src/prisma/capture.ts`) rather than Prisma's `$on('query')` event hook. Middleware composes at construction time, not via runtime subscription.

For the demo, it surfaces every SQL statement (with params, rowCount, latencyMs) into the GraphQL response's `extensions.prismaNext.executions[]` so the audience can see exactly how many queries each GraphQL request fires. Cleaner story for tracing / auditing / caching than mutating an event emitter.

### Capability-gated execution strategy

`selectIncludeStrategy` in the orm-client (`packages/3-extensions/sql-orm-client/src/include-strategy.ts`) reads `contract.capabilities[targetFamily]` / `[target]` and picks `lateral` / `correlated` / `multiQuery` based on `jsonAgg` and `lateral` flags. The plugin doesn't choose how its includes get compiled to SQL — the runtime does, based on what the target supports.

The flip side: the runtime's vocabulary for `combine` and depth-2+ nested includes is incomplete (Issues A and B in `projects/pothos-prisma-next/issues.md`). Those force fallback to multi-query for the headline shapes. Plugin-side correctness isn't affected; statement counts in `extensions.prismaNext.executionCount` are honest about it.

## D. Pothos-specific integration patterns we discovered

Things you almost certainly know already, but worth flagging because they're how we made the integration work cleanly:

### `pothosExposedField` does the column-lookup work for free

Set automatically by every `t.exposeX(name)` (`@pothos/core` `fieldUtils/base.ts:107`), carries the column name. The walker reads it directly; no plugin override needed. Means we never had to subclass-and-override `t.exposeID/String/...` — Pothos already gives us the column name on the field config.

### Per-model field builder for relation methods

`t.relation(name)` needs the parent model's identity to constrain `name` against `RelationNames<TContract, ModelName>`. Pothos's structural `ObjectFieldBuilder<Types, ParentShape>` doesn't carry it (parent shape is a row type, not a model name). Demo introduces:

```ts
interface PrismaNextObjectFieldBuilderShape<
  Types extends SchemaTypes,
  ModelName extends string,
> extends PothosSchemaTypes.ObjectFieldBuilder<Types, RowFor<Types, ModelName>> {
  relation<RelName extends RelationsOnModel<Types, ModelName>, ...>(
    name: RelName,
    options?: PrismaNextRelationOptions<Types, ModelName, RelName, Args>,
  ): FieldRef<Types, unknown>;
  // ...
}
```

`prismaObject('User', { fields: t => ... })` types `t` as that interface. Same pattern plugin-prisma's `PrismaObjectFieldBuilder<Types, Model, ParentShape>` uses; the prisma-next version reads the model from a generic instead of from `Model['Name']`.

### Typed `select` on `t.field` via interface merging

For computed resolvers that need columns the user didn't `expose` (e.g. `fullName: parent.firstName + ' ' + parent.lastName`):

```ts
fullName: t.field({
  type: 'String',
  select: { firstName: true, lastName: true },
  resolve: (parent) => `${parent.firstName} ${parent.lastName}`,
}),
```

Augment `PothosSchemaTypes.ObjectFieldOptions` to add `select?: { [K in keyof ParentShape]?: true }`. The walker reads it from `fieldDef.extensions.pothosOptions.select` (Pothos preserves the original options at that key). Plugin-prisma's `pothosPrismaSelect` is the same shape; ours just keys off contract-typed parent rows instead of Prisma's `Model['Select']`.

## What's worth keeping vs throwing away

If you start fresh, **keep**:

- The `RowFor` plumbing into `prismaObject`'s `fields(t)` callback. 5 lines, unblocks everything.
- The fluent `query: (rel) => rel.where(...)` API shape — exact match for `Collection.include`'s refineFn.
- The walker's sibling-grouping into `combine` for `t.relation` aliases + `t.relationCount` peer fields. It's the prisma-next-native answer to a problem plugin-prisma doesn't have.
- Capture-via-middleware for `extensions.prismaNext` (or whatever name; useful for the demo regardless).

**Throw away** without ceremony:

- The walker's W-1 FK-augmentation workaround (`auto-include.ts:collectLocalFkColumnsByGroup`) — that's a band-aid for an orm-client bug we'll fix.
- Anything Relay / connections / interfaces / nodes / select-mode / value-objects — never implemented.
- The dataloader story is missing entirely; demo throws on `t.relation` outside `t.prismaField`. Plug your existing dataloader integration in for the lazy-load case.
- The runtime FK augmentation is depth-1 only on the multi-query path; documented but not fixed.

## Appendix: relevant prisma-next files

For when you're reading the orm-client / contract source:

- **Row inference**: `packages/3-extensions/sql-orm-client/src/types.ts` — `DefaultModelRow`, `RelationNames`, `RelatedModelName`, `ShorthandWhereFilter`.
- **Codec output chain**: `packages/2-sql/4-lanes/relational-core/src/types.ts` — `ComputeColumnJsType`.
- **Collection API**: `packages/3-extensions/sql-orm-client/src/collection.ts` — `where`, `orderBy`, `include`, `combine`, `all`, `firstOrThrow`.
- **Include refinement shape**: `packages/3-extensions/sql-orm-client/src/collection-internal-types.ts` — `IncludeRefinementCollection`, `IsToManyRelation`.
- **Strategy selection**: `packages/3-extensions/sql-orm-client/src/include-strategy.ts` — capability-driven lateral/correlated/multi-query dispatch.
- **Middleware**: `@prisma-next/sql-runtime` exports `SqlMiddleware`.

For the demo's plugin code itself:

- `examples/pothos-integration/src/plugin/global-types.ts` — type augmentations + `RowFor` / `RelationsOnModel` / `RelationCollectionFor`.
- `examples/pothos-integration/src/plugin/auto-include.ts` — selection walker, sibling-grouping, reshape.
- `examples/pothos-integration/src/plugin/index.ts` — `BasePlugin` with `wrapResolve` dispatch.
- `examples/pothos-integration/src/schema.ts` — consumer-side surface example.
