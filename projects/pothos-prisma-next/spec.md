# Summary

Build a minimal Pothos GraphQL schema-builder plugin (`@pothos/plugin-prisma-next`) that integrates the prisma-next contract + ORM client into Pothos, providing the same auto-include experience as `@pothos/plugin-prisma` but built on prisma-next's Collection API. Goal: a workable demo that the Pothos author can play with on the same day to validate the integration shape before any production-grade work begins.

# Description

`@pothos/plugin-prisma` is the canonical way to build GraphQL APIs over Prisma: it lets users declare GraphQL types backed by Prisma models, walks the GraphQL `ResolveInfo` to pre-load nested relations in a single Prisma query, and exposes Relay/connection helpers. The plugin reaches into Prisma client internals (DMMF, `_runtimeDataModel`) and ships a TypeScript generator (`prisma-pothos-types`) to expose per-model `Include`/`Select`/`Where` types that Prisma client itself produces too verbosely for editor performance.

Prisma-next's contract-first design and Collection-based ORM client offer a cleaner substrate for the same job. Per-model metadata is in the public `Contract` (no `_underscored` reach-ins), the SQL builder already exposes capability-gated lateral joins with explicit aliases, and the Collection's `combine()` primitive solves the "two GraphQL aliases on the same relation" case that Prisma can't.

The deliverable is a single workspace package containing the plugin and a runnable demo against `examples/prisma-next-demo`'s contract. The demo's purpose is to drive a same-day conversation with the Pothos author about which prisma-next-side ergonomic gaps (none currently identified as blockers) are worth investing in. The plugin's surface is intentionally narrow: enough to demonstrate the headline auto-include flow and the drafts/posts (sibling-aliased same-relation) pattern, nothing more.

Decisions already made:

- **Bind to model name, not table name.** Plugin reads `contract.models[ModelName]` for relations, fields, storage mapping. Models are the typed-domain abstraction; tables are storage details.
- **Auto-include via recursive walker chaining `.select()` and `.include()`.** No literal include-tree IR; the plugin builds up a Collection by chaining methods. The closure-based `.include(rel, refineFn)` API works fine when the refinement is built recursively from the GraphQL subselection.
- **Sibling-aliased fields collapse into `combine`.** When two GraphQL fields back the same prisma-next relation (`drafts: t.relation('posts', { where: ... })` and `posts: t.relation('posts', { where: ... })`), the plugin emits a single `.include('posts', p => p.combine({ drafts: ..., posts: ..., totalCount: p.count() }))`. Single-field-per-relation cases stay as plain `.include(rel, ...)`.
- **Resolver always sees flat parent shape.** The plugin's `wrapResolve` reshapes the parent row when combine was used so that `t.relation('drafts', ...)` resolvers always see `parent.drafts` directly (never `parent.posts.drafts`). The combine nesting is a runtime/optimization concern, not a user-facing one.
- **`t.prismaField` resolver receives a prepared Collection.** Resolver chains its own entry method: `(collection, _root, _args, ctx) => collection.first({ id: ctx.userId })`. The collection arrives pre-configured with the auto-include selection.
- **`firstOrThrow` lives on `AsyncIterableResult`.** `collection.where(...).all().firstOrThrow()` is the idiomatic must-exist pattern.
- **Capability gating dropped.** The runtime errors when `lateral`/`jsonAgg` are absent are clear; duplicating the check at schema-build time adds code without value.
- **Batching out of scope.** Pothos's existing dataloader story (or one the Pothos author builds) handles N+1 mitigation if needed. The plugin does no microtask coalescing.
- **Fallback path throws clearly.** A `t.relation` field reachable from a parent not loaded by `t.prismaField` raises `Error: 't.relation' field 'X.posts' was reached from a parent not loaded by t.prismaField. Use t.prismaField as the entry point, or construct your own Collection.` at resolve time. No lazy-load.

# Requirements

## Functional Requirements

**As a GraphQL author** I want to declare a Pothos object type backed by a prisma-next model:

```ts
builder.prismaObject('User', {
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    posts: t.relation('posts'),
  }),
});
```

**As a GraphQL author** I want to define an entry-point field that resolves to a prisma-next-backed object, where Pothos has already prepared the Collection with all transitive relations and selections:

```ts
me: t.prismaField({
  type: 'User',
  resolve: (collection, _root, _args, ctx) =>
    collection.where({ id: ctx.userId }).all().firstOrThrow(),
})
```

**As a GraphQL author** I want sibling fields backed by the same prisma-next relation but with different filters/orderings/limits to resolve in one query plan:

```ts
drafts: t.relation('posts', { where: { published: false } }),
posts:  t.relation('posts', {
  where: { published: true },
  orderBy: (p) => p.createdAt.desc(),
}),
postCount: t.relationCount('posts'),
```

**As a GraphQL author** I want field-level scalar helpers (`t.exposeID`, `t.exposeString`, `t.exposeInt`, `t.exposeBoolean`, `t.exposeFloat`) that auto-add the column to the parent's selection.

**As a GraphQL author** I want a clear error at resolve time if a `t.relation` is accessed from a parent that wasn't loaded by a `t.prismaField` (and pointing me at the fix).

**As a plugin user** I want builder-level configuration that wires the prisma-next runtime in:

```ts
const builder = new SchemaBuilder<{
  PrismaNextContract: Contract;
}>({
  plugins: [PrismaNextPlugin],
  prismaNext: {
    runtime,        // from postgres<Contract>({...})
    contract,       // the typed Contract
    db,             // ORM client (createOrmClient(runtime))
  },
});
```

**As a plugin user** I want types to flow from `Contract` straight through to resolver `parent` shapes, without a separate generator step.

## Non-Functional Requirements

- **Type safety:** No `any`. No `@ts-expect-error` outside negative type tests. The contract's per-model metadata is the source of truth for relation/field shapes.
- **Single-query path on the common case:** Single-field-per-relation `t.relation` calls compile down to a plain `.include(rel, ...)`, which the runtime executes as one LATERAL join (assuming `lateral && jsonAgg` capabilities, true for the demo Postgres adapter).
- **Multi-query acceptable on combine:** `combine` triggers prisma-next's multi-query include strategy today (1 + N branches). Fine for v1; the prisma-next team can later teach the lateral strategy to handle combine without any plugin changes.
- **Demo runs against `examples/prisma-next-demo`:** No new schema; reuse the existing contract.
- **Compatible with Pothos main:** Plugin sits in the Pothos workspace (or a sibling that depends on Pothos via `workspace:*`-style or local file path) without forking core.
- **Time-boxed:** Workable end-to-end demo by end of day. Surface is intentionally narrow.

## Non-goals

These are deliberately out of scope for the demo (and probably v1):

- Relay integration (`prismaConnection`, `relatedConnection`)
- Type variants (`prismaInterface`, `prismaNode`-with-variants)
- Polymorphism / discriminators (Task → Bug/Feature)
- Indirect (M:N via join table) relations
- Cursor pagination on relations
- Fallback `findUnique` path for parents not loaded by `t.prismaField` (throws instead)
- `select`-mode for types (Pothos-prisma's narrow-shape feature)
- Value objects (e.g. `Address`)
- Codec-aware exposes (custom GraphQL scalar mapping per codec) — `exposeString`/`exposeInt`/`exposeID` cover the demo
- Per-tick batched `findUnique` coalescer
- Capability gating at schema-build time
- TypeScript generator (`prisma-pothos-types` equivalent)
- Custom subscription/streaming integration

# Acceptance Criteria

- [ ] **Project structure**: a single package exists with the plugin source, a contract-aware example schema, a runnable demo entry point, and a README explaining what's in/out of scope.
- [ ] **`builder.prismaObject('User', { fields })`** registers a GraphQL object type whose `parent` shape is inferred from the prisma-next `Contract`'s `User` model.
- [ ] **`t.exposeID/String/Int/Boolean/Float`** add the corresponding column to the parent's selection only when the GraphQL field is queried, and pass through `parent.fieldName`.
- [ ] **`t.relation('posts')`** registers a list field backed by the `posts` relation and adds a plain `.include('posts', ...)` to the parent's prepared Collection when present in the query.
- [ ] **`t.prismaField({ type: 'User', resolve })`** invokes the resolver with a prepared Collection that has the auto-include tree applied; `collection.all().firstOrThrow()` returns a row matching the prepared selection.
- [ ] **Drafts/posts case**: a query with `me { drafts { id } posts { id title } postCount }` resolves via a single outer query and one combined include per relation; the resolver returns one User row with `drafts: Post[]`, `posts: Post[]`, and `postCount: number` — flat keys, no `parent.posts.drafts` leak.
- [ ] **`t.relationCount('posts', { where })`** returns a peer field of type `Int!` whose value matches the count branch in the underlying combine.
- [ ] **Fallback error**: a schema that mounts a `t.relation` field on an object whose parent is not loaded by `t.prismaField` throws a clear runtime error pointing the user at `t.prismaField` (or instructions for manually constructing a Collection).
- [ ] **Type tests**: `pnpm typecheck` passes on the package; resolver `parent` types match the prepared selection (i.e. `posts` is present iff `t.relation('posts')` is in the type's fields).
- [ ] **Smoke test / runnable demo**: invoking the demo CLI/script against the local Postgres runtime returns the expected JSON for the headline query (`me { id email drafts { id } posts { id title comments { id author { fullName } } } }` or equivalent), in one or two queries (depending on combine usage), with no type errors.
- [ ] **README** documents: install, usage, the canonical pattern, the drafts/posts pattern, the explicit non-goals, and the fallback-error behavior.

# Other Considerations

## Security

Not applicable to the plugin itself — no auth, no secrets, no remote endpoints. The plugin inherits prisma-next's existing parameterization safety; it does not construct raw SQL.

## Cost

Zero operational cost — library code only. No infra. The demo can run against the same local Postgres the existing demo uses.

## Observability

Out of scope for v1. Errors propagate via the standard prisma-next runtime error envelope. If we want post-demo telemetry, the plugin can publish events through the existing `createTelemetryMiddleware()` already in `examples/prisma-next-demo/src/prisma/db.ts` without changes.

## Data Protection

Not applicable.

## Analytics

Not applicable.

# References

- **Pothos repo (local)**: `.claude/repos/hayes/pothos` — `packages/plugin-prisma/src/` is the structural template (`schema-builder.ts`, `prisma-field-builder.ts`, `model-loader.ts`, `util/map-query.ts`, `util/selections.ts`).
- **Prisma-next demo contract**: `examples/prisma-next-demo/src/prisma/contract.{json,d.ts}` — provides `User`, `Post`, `Task` (with Bug/Feature variants), with relations.
- **ORM client docs**: `packages/3-extensions/sql-orm-client/` — the `Collection`, `combine`, `include` primitives we build on.
- **`HasIncludeManyCapabilities` predicate**: `packages/2-sql/4-lanes/relational-core/src/types.ts:161-174`.
- **`firstOrThrow`**: `packages/1-framework/1-core/framework-components/src/execution/async-iterable-result.ts:68-77`.

# Decisions

The six load-bearing decisions are locked. None require Pothos-side changes; the plugin is a third-party package that depends on `@pothos/core` from npm.

1. **Plugin location.** New package at `examples/pothos-integration/` in this repo. Depends on `@pothos/core` from npm. Reads the local `.claude/repos/hayes/pothos/` only as a reference for patterns. **Pothos plugins are not required to live in the Pothos monorepo** — they're standard npm packages that import from `@pothos/core` and call `SchemaBuilder.registerPlugin(...)` plus a `declare module '@pothos/core'` augmentation. If the Pothos author wants to upstream after the demo, moving from `examples/pothos-integration/src/plugin/` into `pothos/packages/plugin-prisma-next/` is `mv` + dep-version pin.

2. **No generator.** Plugin types parameterize on `TContract extends Contract<SqlStorage>`. Per-model row, relation, and field types derive from `DefaultModelRow<TContract, ModelName>`, `RelationNames<TContract, ModelName>`, etc. User passes `Contract` as a builder type-parameter: `new SchemaBuilder<{ PrismaNextContract: Contract }>(...)`.

3. **Builder options.** `{ prismaNext: { db, runtime, contract } }`, where `db` is the orm-client's per-model accessor returned by `createOrmClient(runtime)`. Plugin reads `db[ModelName]` as the per-model Collection factory.

4. **Demo entry point.** Runnable `graphql-yoga` server with GraphiQL playground enabled. Pothos generates the executable schema; `graphql-yoga` exposes it over HTTP. SQL execution counts surface either via stdout logs (from `createTelemetryMiddleware` in `examples/prisma-next-demo/src/prisma/db.ts`) or via response extensions. Run with `pnpm --filter pothos-integration dev`.

5. **Sibling grouping.** Any two GraphQL fields whose `t.relation`/`t.relationCount` config points at the same prisma-next relation collapse into a single `.include(rel, p => p.combine({...}))`. Single-field-per-relation stays as plain `.include(rel, ...)`. Identical-args duplicates are not deduped — separate branches with identical data is the safe default.

6. **Field-time options on `t.relation`.** Accept a static refine object on the field config (`{ where, orderBy, take, skip, distinct, distinctOn }`) plus an optional `query: (args, ctx) => ({...})` callback for arg-dependent refinement. The plugin translates these into a Collection refine callback when emitting the include — no orm-client API change required (the static object becomes calls into the refine collection at include-build time).

# Open Questions

None blocking the demo. Implementation-time decisions only:

- Exact shape of the SQL-count surfacing in the GraphiQL response (extension vs response header vs stdout-only).
- Naming of the field-time refine option: `query`, `refine`, or `relationOptions`. Pothos-prisma uses `query`; matching that minimizes the cognitive jump for Pothos users.
