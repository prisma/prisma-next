# Pothos Integration Demo Plan

## Summary

Build a minimal `@pothos/plugin-prisma-next`-style plugin at `examples/pothos-integration/` and wire it into a runnable `graphql-yoga` server against `examples/prisma-next-demo`'s contract. Goal: a working GraphiQL playground demonstrating the canonical auto-include flow and the drafts/posts sibling-aliased pattern, ready for a same-day conversation with the Pothos author. Throwaway demo — both `projects/pothos-prisma-next/` and `examples/pothos-integration/` are transient and slated for removal at close-out (or kept as a reference if the conversation produces follow-on work).

**Spec:** `projects/pothos-prisma-next/spec.md`

## Collaborators

| Role         | Person/Team       | Context                                                                  |
| ------------ | ----------------- | ------------------------------------------------------------------------ |
| Maker        | Sævar Berg        | Drives the demo build                                                    |
| Reviewer     | Prisma-next team  | Validate that the plugin's prisma-next-side usage matches intended idiom |
| Audience     | Michael Hayes     | Pothos author; the demo audience for the same-day conversation           |

## Shipping Strategy

Not applicable in the production-deploy sense — the deliverable is a workspace example, not a published package. There is no backward-compatibility surface. Both milestones are demoable independently; M1 stands alone as a working example of the canonical flow even if M2 isn't reached. Throughout: no edits to existing prisma-next packages or examples; everything new is additive under `examples/pothos-integration/`.

## Test Design

| AC    | TC    | Test Case                                                                                                                              | Type             | Milestone | Expected Outcome                                                                                       |
| ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| AC-1  | TC-1  | Package scaffold exists (`package.json`, `tsconfig.json`, `biome.jsonc`, `src/`, `README.md`)                                          | Manual           | M1        | `pnpm --filter pothos-integration typecheck` passes; `ls examples/pothos-integration/src` shows layout |
| AC-2  | TC-2  | `builder.prismaObject('User', ...)` registers a GraphQL type whose row shape derives from `Contract`'s User model                      | Integration      | M1        | `printSchema(schema)` shows `type User` with declared fields                                           |
| AC-3  | TC-3  | `t.exposeString('email')` adds the `email` column to the parent's selection only when `email` is queried                               | Integration      | M1        | Generated SQL projects only queried scalar columns + required join columns                             |
| AC-4  | TC-4  | `t.relation('posts')`; query `{ me { posts { id title } } }` emits one `.include('posts', ...)` and resolves in one query              | Integration      | M1        | One execution recorded against runtime; lateral plan shape                                             |
| AC-5  | TC-5  | `t.prismaField({ resolve: (c, ...) => c.first({...}) })` passes a typed Collection as the first arg                                    | Type+Integration | M1        | `tsc --noEmit` passes; runtime returns the first row matching where                                    |
| AC-6  | TC-6  | `me { drafts { id } posts { id } }` (both backed by prisma-next `posts` relation): resolver parent shows flat `drafts` and `posts`     | Integration      | M2        | Resolver receives `parent.drafts: Post[]`, `parent.posts: Post[]` (no `parent.posts.drafts` leak)      |
| AC-7  | TC-7  | `t.relationCount('posts')` exposes `Int!` peer field; query returns correct count                                                       | Integration      | M2        | Field type `Int!`; value matches `db.User.first().posts.count()` against same data                     |
| AC-8  | TC-8  | `t.relation('posts')` mounted on a type whose parent didn't come from `t.prismaField`: invoking the resolver throws a clear error       | Integration      | M2        | Error message names the field path and points at `t.prismaField` as the fix                           |
| AC-9  | TC-9  | Type-level: `t.prismaField`'s `parent` and `t.relation`'s `parent` shapes are inferred from `Contract` and the field's selections      | Type             | M2        | Type tests pass: `expectTypeOf<...>().toEqualTypeOf<...>()` holds                                      |
| AC-10 | TC-10 | End-to-end: `pnpm --filter pothos-integration dev` boots the server; the headline query in GraphiQL returns expected JSON              | Manual           | M2        | Browser/curl returns canonical query data; SQL execution count visible in stdout                       |
| AC-11 | TC-11 | README documents install, usage, canonical flow, drafts/posts, non-goals, fallback-error behavior                                       | Manual           | M2        | All six sections present; minimal copy-pastable code blocks                                            |

## Milestones

### Milestone 1: Canonical flow (single relation, single GraphQL field per relation)

Delivers a working GraphiQL playground that resolves the canonical Pothos pattern: `me { id email posts { id title } }` end-to-end via one query. No combine, no count, no fallback handling yet — but every primitive that supports the headline pattern is in place.

**Tasks:**

- [ ] Scaffold `examples/pothos-integration/` with `package.json` (`type: module`, engines node >=24, scripts: `dev`, `typecheck`, `lint`), `tsconfig.json` extending `@prisma-next/tsconfig`, `biome.jsonc`, empty `src/` layout (`plugin/`, `schema.ts`, `server.ts`), README stub. (satisfies: TC-1)
- [ ] Add dependencies: `@pothos/core`, `graphql`, `graphql-yoga`, the prisma-next workspace deps the demo needs (`@prisma-next/postgres`, `@prisma-next/sql-orm-client`, `@prisma-next/sql-runtime`, `@prisma-next/sql-contract`, `@prisma-next/middleware-telemetry`, `@prisma-next/extension-pgvector`), `tsx` for the dev script. (satisfies: TC-1)
- [ ] Implement `src/plugin/index.ts`: `PothosPrismaNextPlugin extends BasePlugin`, `pluginName = 'prismaNext'`, `SchemaBuilder.registerPlugin(...)`, with empty `wrapResolve` and `onTypeConfig` stubs. (satisfies: TC-1, TC-2)
- [ ] Implement `src/plugin/global-types.ts`: declare module `@pothos/core` augmentation adding `prismaNext` to `SchemaBuilderOptions`, `Plugins`, plus `PrismaNextContract` slot in `SchemaTypes`. (satisfies: TC-2, TC-5)
- [ ] Implement `src/plugin/schema-builder.ts`: `builder.prismaObject(modelName, opts)` registers an object type, sets `extensions.prismaNextModel = modelName` for use by walker/resolver hooks. Reads `contract.models[modelName]` from builder options for relations/fields. (satisfies: TC-2)
- [ ] Implement `src/plugin/field-builder.ts`: `t.exposeID/String/Int/Boolean/Float(fieldName, opts?)` — registers a scalar field whose `extensions.prismaNextSelect = fieldName` causes the walker to add the column to the parent selection. Resolver does `parent[fieldName]`. (satisfies: TC-3)
- [ ] Implement `t.prismaField(opts)`: registers an entry-point field whose resolver receives a prepared Collection. Walker constructs the collection from `info` before calling the user resolver. Built-in resolver wrapping calls `userResolve(collection, root, args, ctx, info)`. (satisfies: TC-5)
- [ ] Implement `t.relation(name, opts?)`: registers a list/single field backed by `contract.models[parentModel].relations[name]`. Sets `extensions.prismaNextRelation = { name, opts }`. Resolver does `parent[name]`. (satisfies: TC-4)
- [ ] Implement the auto-include walker (`src/plugin/auto-include.ts`): walk the GraphQL `info`, recursively chain `.select(...)` and `.include(rel, refineFn)` onto the entry-point Collection. Single-relation case only (M1 scope). (satisfies: TC-3, TC-4, TC-5)
- [ ] Wire `src/server.ts`: `graphql-yoga` server using a Pothos schema built against `examples/prisma-next-demo`'s `Contract`; load `runtime`, `db`, `contract` via the same factory pattern as the existing demo; expose GraphiQL at `/graphql`. (satisfies: TC-4, TC-5)
- [ ] Define `src/schema.ts` with a small headline schema: `Query.me`, `User`, `Post`, with `t.exposeID/String` fields and one `t.relation('posts')` on User. Plus a User-by-id query for AC-3 isolation. (satisfies: TC-2, TC-3, TC-4, TC-5)
- [ ] Smoke test: boot the server, run `me { id email posts { id title } }` in GraphiQL, observe single SQL execution and correct JSON. (satisfies: TC-2, TC-3, TC-4, TC-5)

**Validation gate:**

- `pnpm --filter pothos-integration typecheck`
- `pnpm --filter pothos-integration lint`
- Manual: `pnpm --filter pothos-integration dev` boots; GraphiQL at http://localhost:4000/graphql returns expected data for the headline query

### Milestone 2: Sibling combine + count + hardening + close-out

Delivers the headline differentiator versus pothos-prisma: same-relation aliased siblings (drafts/posts) plus `t.relationCount` resolved through `combine` with parent-shape reshape, so resolvers always see flat keys. Plus the explicit fallback error, type tests, and README.

**Tasks:**

- [ ] Extend the auto-include walker with sibling-grouping: when ≥2 fields on the same parent type point at the same prisma-next relation, collapse them into one `.include(rel, p => p.combine({...}))` with one branch per GraphQL field/alias. (satisfies: TC-6)
- [ ] Implement `t.relationCount(name, opts?)`: registers a peer `Int!` field whose include contribution is a `count()` branch under the same combine block as the relation it counts. (satisfies: TC-7)
- [ ] Implement the `wrapResolve` reshape: when a parent value contains a combine block (detectable by walker-set `extensions.prismaNextCombineBranches`), lift each branch up to the top level keyed by GraphQL field/alias name once per parent row, marked as already-reshaped to avoid re-walking. (satisfies: TC-6, TC-7)
- [ ] Implement the fallback error: in the relation field's resolve wrapper, if `parent` lacks the prisma-next relation key (i.e. parent wasn't loaded by `t.prismaField`), throw a clear error naming the field path and pointing at `t.prismaField` as the fix. No lazy-load. (satisfies: TC-8)
- [ ] Add type tests at `examples/pothos-integration/src/types.test-d.ts`: assert `t.prismaField`'s resolver receives `Collection<Contract, ModelName>`, that `t.relation`'s `parent` shape is the model row, and that contract type-parameter flow is intact. (satisfies: TC-9)
- [ ] Extend `src/schema.ts` to demonstrate the headline differentiator: add `drafts: t.relation('posts', { query: { where: { published: false } } })`, `posts: t.relation('posts', { query: { where: { published: true } } })`, and `postCount: t.relationCount('posts')`. *Open: requires a `published` column on `Post`. If the existing demo contract doesn't have it, add a minimal `published` boolean to `examples/pothos-integration/src/schema.ts` via a separate small contract, OR skip `published` and use a different existing predicate (e.g. partition `posts` on `views` thresholds). Decided at execution time.* (satisfies: TC-6, TC-7)
- [ ] Smoke test: GraphiQL query `me { drafts { id } posts { id title } postCount }` returns flat `drafts`, `posts`, `postCount` keys; SQL execution count = 1 outer + N branch queries (combine triggers multi-query strategy in current orm-client; document this in README). (satisfies: TC-6, TC-7, TC-10)
- [ ] Write `examples/pothos-integration/README.md` with: intent (throwaway demo for Pothos chat), install/run instructions, canonical flow code sample, drafts/posts code sample, explicit non-goals from the spec, fallback-error behavior. (satisfies: TC-11)
- [ ] **Close-out**: verify all ACs met against the running demo; commit final state; mark `projects/pothos-prisma-next/` for deletion (defer actual deletion until after the same-day conversation, in case follow-up notes land in the project folder); decide with the team whether `examples/pothos-integration/` stays as a reference example or also gets removed.

**Validation gate:**

- `pnpm --filter pothos-integration typecheck`
- `pnpm --filter pothos-integration lint`
- Manual: GraphiQL runs the canonical query (M1) and the drafts/posts query (M2) returning correct JSON; stdout shows expected SQL execution counts; deliberately mounting a `t.relation` field outside `t.prismaField` throws the documented error

## Open Items

Implementation-time decisions and risks; not blocking start of M1.

- **SQL execution count surfacing.** Default: print to stdout via `createTelemetryMiddleware()` already in the demo's `db.ts`. Alternatives (response extension, header) are nicer but more code. Decide during M1 wiring.
- **Refine-option naming.** Default: match pothos-prisma's `query` field option. Mentioned in the spec.
- **`published` column for the drafts/posts demo.** The existing `examples/prisma-next-demo` Post model may not have `published`. Decide at M2 start: add a minimal contract just for the demo, OR partition existing posts on a different predicate.
- **Type-test framework.** Default: `expectTypeOf` from vitest, matching the existing prisma-next-demo's pattern. Confirm during M2.
- **Demo deletion vs. retention.** Decide post-conversation with the team. Plan assumes deletion as default; readiness to retain is captured in close-out.
- **Fallback-error path semantics.** If a field has a custom `resolve`, the user is opting into manual fetching — should the plugin still throw? Default: yes. The expectation is that custom resolvers don't use `t.relation`; they use `t.field` with their own resolver. Confirm during M2.
