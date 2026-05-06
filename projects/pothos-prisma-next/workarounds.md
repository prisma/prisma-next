# Workarounds & Design Decisions Log

Live record of every workaround applied and every load-bearing design decision made while building the demo. Each entry documents:

- **What**: the workaround / decision in one sentence
- **Why**: the underlying problem (with file:line references where applicable)
- **How**: the concrete fix or design choice
- **Cost**: who pays for this — demo only, or does it affect a v2 plugin?
- **Action item**: what we'd do to unblock or remove the workaround in production

**Update this file every time a new workaround or load-bearing decision lands.** Easier to evaluate at close-out than to reconstruct from git history.

---

## W-1: orm-client recursive nested-stitch foreign-key gap

**The biggest one.** A real prisma-next bug, not just a quirk.

### What

When the auto-include walker emits an `.include(...)` chain like `users → posts → comments → author`, the orm-client's stitching logic fetches each level as a separate SQL query and ties them together by foreign-key matching. The bug: **the orm-client only auto-augments the immediate FK columns, not the next level's FK columns**. So a 3+ level deep stitch fails because intermediate levels don't have the FK they need to look up the next level.

### Why — the gory detail

Walk through what happens when you query `users { posts { comments { author { firstName } } } }`:

**Query 1: fetch users.**
```sql
SELECT user.id, user.firstName FROM user
```
Returns `[{ id: 'A', firstName: 'Alice' }, { id: 'B', firstName: 'Bob' }]`.

**Query 2: fetch posts for those users.**
```sql
SELECT post.id, post.title, post.authorId FROM post WHERE post.authorId IN ('A', 'B')
```
The orm-client knows we want `posts.authorId IN (parent join values)`. It augments the post fetch with `post.authorId` so it can group children by `authorId` and assign back to each user's `posts: Post[]`.

This augmentation lives in `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:368-417`:

```ts
async function resolveRowsByParent(
  scope, contract, include, state, parentJoinValues,
): Promise<Map<unknown, Record<string, unknown>[]>> {
  const { selectedForQuery: childSelectedForQuery, hiddenColumns: hiddenChildColumns } =
    augmentSelectionForJoinColumns(state.selectedFields, [include.targetColumn]);
  //                                                       ^^^^^^^^^^^^^^^^^^^^^^^
  //                                                       Only adds the column the
  //                                                       child uses to join to its
  //                                                       direct parent (post.authorId).
  //                                                       Does NOT add columns the
  //                                                       child needs to join to its
  //                                                       OWN children (e.g. post.id
  //                                                       for the upcoming
  //                                                       comments include).

  const childCompiled = compileRelationSelect(
    contract, include.relatedTableName, include.targetColumn, parentJoinValues,
    { ...state, selectedFields: childSelectedForQuery },
  );
  const childRowsRaw = await executeQueryPlan(scope, childCompiled).toArray();
  const childRows = childRowsRaw.map(row =>
    createRowEnvelope(contract, include.relatedModelName, row),
  );

  // Recursive descent: stitch grandchildren onto children.
  if (state.includes.length > 0) {
    await stitchIncludes(scope, contract, childRows, state.includes);
  }
  // ...
}
```

**Query 3: fetch comments for those posts.**
```sql
SELECT comment.id, comment.body, comment.postId FROM comment WHERE comment.postId IN (post-ids...)
```
Notice: no `comment.authorId` selected. The augmentation added `comment.postId` (the FK pointing back to `post.id`, used to match comments to their parent post), but **not** `comment.authorId` (which the next stitching level needs to fetch authors).

**Query 4: try to fetch authors of those comments.**

Inside the recursive `stitchIncludes` call, processing the `comment.author` include:

```ts
const parentJoinValues = uniqueValues(
  parentRows.map((row) => row.raw[include.localColumn]).filter((value) => value !== undefined),
);
//                            ^^^^^^^^^^^^^^^^^^^^^^^^^
//                            For comment.author, include.localColumn = 'authorId'.
//                            But row.raw doesn't have 'authorId' — Query 3 didn't
//                            select it. So this returns []. The author fetch
//                            short-circuits to "no parent join values" and returns
//                            an empty result set.
```

Or, in our case, the runtime fails at `comment.raw['authorId'] === undefined` and the author field comes back `null`.

### How — the workaround

Push the missing augmentation up into the auto-include walker itself.

In `examples/pothos-integration/src/plugin/auto-include.ts`, when applying scalar selections to a parent collection, also collect every relation-include's `localFields` and add them to the parent's `.select(...)` call:

```ts
function collectLocalFkColumns(
  buildCache, parentModelName, relationFields,
): Set<string> {
  const out = new Set<string>();
  for (const { ext } of relationFields.values()) {
    const rel = contract.models[parentModelName].relations[ext.relationName];
    if (!rel?.on?.localFields) continue;
    for (const f of rel.on.localFields) out.add(f);
  }
  return out;
}

const allFields = new Set<string>([...scalarFields, ...fkColumns]);
acc = acc.select(...allFields);
```

So when processing Comment with an `author` include in the GraphQL query, the walker explicitly adds `authorId` to Comment's `.select(...)` even though the user only asked GraphQL for `id` and `body`. That way Query 3 becomes:

```sql
SELECT comment.id, comment.body, comment.postId, comment.authorId FROM comment WHERE comment.postId IN (...)
```

And Query 4 can correctly do `WHERE user.id IN (comment.authorId values)`.

### Cost

- **Demo: works.** Verified end-to-end with `users { posts { comments { author { firstName } } } }`.
- **v2 plugin: still needs this**, OR the orm-client should be fixed.
- **Other prisma-next users**: anyone hitting nested includes through the orm-client will have this bug latent. The existing prisma-next-demo's queries don't go deep enough to trigger it (max 2 levels: `db.User.include('posts', ...)`).

### Action item

**File a Linear ticket against prisma-next (orm-client)** to make `resolveRowsByParent` recursively augment child `selectedFields` with the localFields of the child's own includes. The fix is in `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:368-417`:

```ts
// Existing:
const requiredColumns = [include.targetColumn];

// Should be:
const requiredColumns = [
  include.targetColumn,
  ...collectNestedIncludeLocalColumns(state.includes, contract, include.relatedModelName),
];
```

Where `collectNestedIncludeLocalColumns` walks `state.includes` and resolves each one's `localColumn` from the contract.

Once fixed in the orm-client, the walker workaround (`collectLocalFkColumns` in `auto-include.ts`) becomes redundant and can be deleted.

---

## W-2: `t.exposeID/String/etc` against the loose parent shape ✅ fixed in `examples/pothos-integration/src/plugin/global-types.ts`

> **Update.** I originally claimed this was blocked by missing type-level machinery and would need a several-day "infer model row from Contract" project. That was wrong. The orm-client already exports `DefaultModelRow<TContract, ModelName>` (`packages/3-extensions/sql-orm-client/src/types.ts:429`), which is exactly that inference. Wiring it into Pothos's `prismaObject` was a 5-line change. The plugin now plumbs `RowFor<Types, ModelName> = DefaultModelRow<Types['PrismaNextContract'], ModelName>` through the `ObjectFieldBuilder`'s `ParentShape` slot, and `t.exposeID/String/...` works as you'd expect. The original analysis below is preserved for the "why this fails when the shape is loose" walk-through; the action-item sketch is no longer accurate.

### What (originally)

Pothos's `t.exposeX(name)` helpers fail TypeScript checks when the parent shape is loose. Used `t.field({ type: 'X', resolve })` instead.

### Why

Pothos constrains `name` via `CompatibleTypes<Types, ParentShape, 'ID' | 'String' | …, true>` (`@pothos/core/src/types/builder-options.ts:284-298`):

```ts
export type CompatibleTypes<Types, ParentShape, Type, Nullable> = {
  [K in keyof ParentShape]-?: Awaited<ParentShape[K]> extends ShapeFromTypeParam<Types, Type, Nullable>
    ? K
    : never;
}[keyof ParentShape] & string;
```

For our original `ParentShape = Record<string, unknown>`:
- `keyof Record<string, unknown>` is `string`
- `Record<string, unknown>['anything'] = unknown`
- `Awaited<unknown> extends ShapeFromTypeParam<Types, 'ID', true>` → `unknown extends string | null` → **false**

So all keys map to `never`, and the constraint resolves to `never & string = never`. Hence `t.exposeID('id')` errored with *"Argument of type '\"id\"' is not assignable to parameter of type 'never'"*.

### The fix that landed

`global-types.ts` declares:

```ts
type RowFor<Types extends SchemaTypes, ModelName extends string> =
  Types['PrismaNextContract'] extends Contract<SqlStorage>
    ? DefaultModelRow<Types['PrismaNextContract'], ModelName>
    : Record<string, unknown>;
```

Then `prismaObject<ModelName>`'s options interface threads `ModelName` through, and the `fields(t)` callback receives `ObjectFieldBuilder<Types, RowFor<Types, ModelName>>`. With `Types['PrismaNextContract']` set to the user's typed Contract, `RowFor` resolves to `{ id: string; firstName: string; ... }` per model, and Pothos's `CompatibleTypes` lookup returns the actual field names instead of `never`. `prismaField`'s `collection` arg got the same upgrade so `db.User.where(...).all().firstOrThrow()` chains without a cast.

### Cost

- **Demo: clean.** Every scalar field is one line (`t.exposeID('id')`); the `userById` resolver no longer needs a `as unknown as {...}` cast.
- **v2 plugin: same machinery is the right answer.** `DefaultModelRow` is already the orm-client's canonical row shape; the plugin reuses it instead of re-deriving.

### Why the original fear was wrong

I assumed Pothos-prisma's "generator → `Prisma.User` types" pattern was load-bearing and that prisma-next would need an analogous codec-output registry. It already has one — codec output types are carried as phantom `TJs` in each `Codec<Id, TWire, TJs, TParams, THelper>`, surfaced through `ComputeColumnJsType` (`packages/2-sql/4-lanes/relational-core/src/types.ts:132`), and finally assembled into `DefaultModelRow`. The orm-client's `firstOrThrow()` and the SQL builder's `.build()` both terminate in this chain — that's why their return types come back fully decoded. The Pothos plugin just had to reuse the same chain.

---

## W-3: Symbol-keyed extensions weren't being preserved

### What

Switched from `Symbol.for('pothos-prisma-next/relation')` to plain string keys (`'pothosPrismaNextRelation'`) for extension keys.

### Why

Initial implementation used symbols. The walker's `field.extensions[symbol]` returned `undefined` at runtime even though the field config was registered with the symbol key. Switched to string keys, walker started seeing the extensions.

I didn't dig into the exact reason — Pothos likely copies extension dictionaries via `{...config.extensions}` somewhere, and either (a) the spread doesn't preserve symbols (which it should, in spec-compliant JS), or (b) the copy goes through a `JSON.stringify`/`JSON.parse` round trip somewhere that drops symbols.

### How

`PRISMA_NEXT_RELATION = 'pothosPrismaNextRelation'` (string), etc. See `examples/pothos-integration/src/plugin/types.ts`.

### Cost

- **Demo: works.**
- **v2 plugin: same string keys are fine.** Pothos plugins universally use string keys for extensions (look at plugin-prisma's `pothosPrismaSelect`, `pothosPrismaModel`, etc.).
- **Risk**: collision with other Pothos plugins also using `pothosPrismaNext*` keys. Mitigation: namespaced prefix.

### Action item

If we ever upstream this, double-check Pothos's extension-copy paths to confirm symbols actually don't survive (and document why).

---

## W-4: Custom field-builder class instead of `ObjectFieldBuilder.prototype` monkey-patching

### What

Created `PrismaNextObjectFieldBuilder extends ObjectFieldBuilder` to host `relation` / `relationCount` methods, instead of patching `ObjectFieldBuilder.prototype.relation = …`.

### Why

`t.relation('posts')` needs the parent model name + contract metadata to resolve the target type. The prototype doesn't know which `prismaObject` it's currently inside. Pothos doesn't pass that context to method calls.

### How

`schema-builder.ts`'s `prismaObject(modelName, opts)` instantiates `new PrismaNextObjectFieldBuilder(this, modelName, contract)` and passes it as the `t` argument to `opts.fields(t)`. The class carries `modelName` + `contract` as instance fields. Same pattern as plugin-prisma's `PrismaObjectFieldBuilder`.

### Cost

- **Not a workaround**, just the right structural pattern once I tried the wrong one.
- No downside.

### Action item

None.

---

## W-5: Phantom type-param slots to satisfy biome lint

### What

`global-types.ts` declarations include unused-but-required type params (`Kind extends FieldKind`, `ParentShape`, `Types`). Biome's `noUnusedVariables` rule flagged them. Worked around by adding phantom optional fields (`_kind?: Kind`, `_parent?: ParentShape`) on the options interfaces so the params are referenced.

### Why

For TypeScript declaration merging to work, my augmentation interfaces must declare the same type params (in number and constraint) as Pothos's base interfaces. But biome's lint rule wants every type param actually used in the body.

### How

```ts
interface PrismaNextRootFieldOptions<
  Types extends SchemaTypes,
  ParentShape,
  ModelName extends string,
  Args extends InputFieldMap,
  Kind extends FieldKind,
> {
  _kind?: Kind;             // phantom — references Kind
  // ... real fields ...
}
```

### Cost

- **Demo: ugly but works.**
- **v2 plugin: same trade-off.** A real plugin would actually use those params (e.g., to vary the resolver shape per kind).

### Action item

When v2 starts using the params for real (e.g., narrowing resolver signatures by FieldKind), delete the phantom slots.

---

## W-6: `objectRef`-by-name cache

### What

Added a `WeakMap<builder, Map<modelName, ref>>` ref cache (`examples/pothos-integration/src/plugin/ref-cache.ts`). Both `prismaObject` and `t.relation` go through it.

### Why

`builder.objectRef('Post')` returns a *new* ref each call — Pothos doesn't dedupe by name. Without a cache:

1. `t.relation('posts')` on User calls `objectRef('Post')` → ref A
2. Later, `prismaObject('Post', ...)` calls `objectRef('Post')` → ref B (different instance)
3. Pothos schema build crashes: *"ObjectRef\<Post\> has not been implemented"* — because ref A was used in the User type but never registered, only ref B was.

Plugin-prisma uses the same pattern (`util/datamodel.ts:7` — `refMap = new WeakMap<object, Map<string, PrismaRef>>`).

### How

```ts
export function getOrCreateModelRef(builder, modelName) {
  let cache = refCache.get(builder);
  if (!cache) { cache = new Map(); refCache.set(builder, cache); }
  let ref = cache.get(modelName);
  if (!ref) { ref = builder.objectRef(modelName); cache.set(modelName, ref); }
  return ref;
}
```

### Cost

- **Demo: works.**
- **v2 plugin: same pattern.**

### Action item

None — this is just plumbing, expected for any name-bound ref system.

---

## D-1: Resolver receives a Collection, not a literal-tree query

### What

`t.prismaField`'s resolver receives a *prepared Collection* (already chained with `.select(...)` / `.include(...)` from the auto-include walker) as its first arg. The user calls `.where(...).all().firstOrThrow()` themselves.

### Why

Pothos-prisma's `(query, root, args, ctx, info) => prisma.user.findUnique({ ...query, where })` only works because Prisma's input is a literal data tree spreadable into a method call. Prisma-next's orm-client uses a chained-method-builder API; there's no spreadable literal.

### How

Plugin's `wrapResolve` for `prismaField` constructs the prepared collection from `info` and passes it to the user resolver. User chains entry-point methods (`.first`, `.all().firstOrThrow`, `.where(...).first`).

### Cost

- **Demo: works.** Slight learning curve for users coming from pothos-prisma.
- **v2 plugin: same pattern.**

### Action item

Document this clearly in the README. Mention that `.all().firstOrThrow()` is the must-exist idiom (vs Prisma's `findUniqueOrThrow`).

---

## D-2: Throw-on-fallback (no lazy load when reached outside `t.prismaField`)

### What

If a `t.relation` field is reached from a parent that wasn't loaded by `t.prismaField`, the resolver throws with a message naming the field path. No lazy-load, no per-microtask coalescer.

### Why

Spec decision; user said batching is out of scope (Pothos's job). Without batching, a lazy-load path would silently N+1 — worse DX than a clear error.

### How

`wrapResolve` reads `parent[fieldName]`; if undefined, throws.

### Cost

- **Demo: works.**
- **v2 plugin: should add lazy-load with a Pothos-side dataloader integration.**

### Action item

After the demo conversation, decide whether to add a lazy-load path. If yes, add a builder option `prismaNext: { fallbackOnMissingParent: 'lazy' | 'throw' }`.

---

## D-3: Loose `Record<string, unknown>` parent shape ✅ replaced with per-model row inference (W-2 fix)

### What (originally)

Parent rows were typed as `Record<string, unknown>` rather than per-model row inference. Resolvers cast `parent as Record<string, unknown>` to access fields.

### Why I thought we needed to punt

I assumed per-model row inference required a codec-output registry that didn't exist yet, and would gate on a contract-API-surface decision. That was wrong (see W-2's "Why the original fear was wrong"). The orm-client's `DefaultModelRow` is exactly that inference, public, exported, and ready to plug in.

### What landed

`prismaObject<ModelName>` now hands the field-builder `ObjectFieldBuilder<Types, RowFor<Types, ModelName>>` where `RowFor` resolves to `DefaultModelRow<Types['PrismaNextContract'], ModelName>`. Resolvers see the real per-field types (`parent.id: string`, `parent.published: number`, etc.), no casts.

### Cost

- **Demo: clean.**
- **v2 plugin: same approach is the right one.** Reuses orm-client machinery rather than reinventing it.

---

## D-4: Combine for sibling-aliased fields ✅ landed in M2

> **Note on the example below.** The original M2 design used the structural-literal `query: { where: ... }` shape (mirroring plugin-prisma's surface). After comparing against the orm-client's idiom, the plugin moved to a fluent refiner callback — `query: (rel, args, ctx) => rel.where(...)` — which exactly matches `Collection.include('rel', refineFn)`. Behaviour and walker emission are identical; only the `query` shape changed. See the handoff notes for the rationale.

### What

When two GraphQL fields back the same prisma-next relation (`drafts: t.relation('posts', { query: (rel) => rel.where({ published: 0 }) })` + `publishedPosts: t.relation('posts', { query: (rel) => rel.where({ published: 1 }) })`), the walker collapses them into a single `.include('posts', p => p.combine({ drafts: ..., publishedPosts: ... }))`. Plugin's `wrapResolve` then reshapes the parent to lift branches up to flat keys (`parent.drafts`, `parent.publishedPosts`).

`t.relationCount('posts')` is emitted as a `count()` branch in the same combine block.

### Why

Validated by the existing prisma-next test (`packages/3-extensions/sql-orm-client/test/integration/include.test.ts:288-297`) — combine is the official primitive for this case.

### How (M2 — landed)

Walker (`src/plugin/auto-include.ts`): when collecting fields, group `relationFields` and `relationCountFields` by `ext.relationName`. If a group has only 1 row field and 0 counts (and the alias matches the relation name), emit a plain `.include(rel, ...)`. Otherwise emit `.include(rel, p => p.combine({ alias: branch, ... }))`. Reshape lifts each branch onto `parent[alias]`. Resolver reads `parent[info.fieldName]` first, then falls back to `parent[relationName]` for the plain-include case.

Verified end-to-end with `users { posts { id } drafts { id } publishedPosts { id } postCount }` returning flat keys with the expected filtered/total values.

### Cost

- Multi-query strategy currently triggers when combine is present. Acceptable for v1 (the demo's `extensions.prismaNext.executionCount` shows users see this clearly: 1 outer + N branch queries).
- **v2 plugin: same pattern**, but prisma-next runtime should later teach the lateral strategy to handle combine in one query.

### Action item

File a Linear ticket against prisma-next runtime: "teach `dispatchWithSingleQueryIncludes` to handle `combine` descriptors so combine-using queries don't fall back to multi-query." Currently `hasComplexIncludeDescriptors` (`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:478-480`) immediately routes to multi-query.

---

## W-8: orm-client's `selectIncludeStrategy` reads capabilities from the wrong path ✅ fixed in `fix/orm-client-include-strategy` (PR #425)

**Real prisma-next bug. Independent of W-1.**

> Status: fixed in `packages/3-extensions/sql-orm-client/src/include-strategy.ts`. The principled fix uses the contract's own `targetFamily` and `target` to scope the capability lookup. Three new emitted-shape unit tests + two regression guards (one MockRuntime, one real Postgres) lock it in. PR: #425.

### What

Every nested include through the orm-client falls back to the multi-query strategy — even when the contract has `jsonAgg: true` (which should pick `'correlated'`, single-query). Reason: the strategy detection looks for capability flags at the wrong level of nesting in `contract.capabilities`.

### Why — the gory detail

`selectIncludeStrategy` (`packages/3-extensions/sql-orm-client/src/include-strategy.ts:6-20`):

```ts
export function selectIncludeStrategy(contract: Contract<SqlStorage>): IncludeStrategy {
  const capabilities = contract.capabilities as Record<string, unknown> | undefined;
  const hasLateral = hasCapability(capabilities?.['lateral']);   // ← top-level 'lateral'
  const hasJsonAgg = hasCapability(capabilities?.['jsonAgg']);   // ← top-level 'jsonAgg'

  if (hasLateral && hasJsonAgg) return 'lateral';
  if (hasJsonAgg) return 'correlated';
  return 'multiQuery';
}
```

It reads `contract.capabilities['lateral']` / `['jsonAgg']` directly. But the contract emitter outputs capabilities **nested under a target/family namespace** (typically `sql`, `postgres`, `sqlite`, etc.):

```json
"capabilities": {
  "sql": {
    "jsonAgg": true,
    "limit": true,
    "orderBy": true,
    "returning": true,
    "foreignKeys": true
  }
}
```

So:
- `capabilities['lateral']` → undefined → `hasCapability(undefined)` → false
- `capabilities['jsonAgg']` → undefined → false
- strategy → `'multiQuery'`

Every nested include becomes N+1 SQL queries instead of one.

The orm-client's own integration test that supposedly exercises the lateral path (`packages/3-extensions/sql-orm-client/test/integration/include.test.ts:332-337`) sidesteps this by passing capabilities at the **top level** via a test helper:

```ts
const users = createUsersCollectionWithCapabilities(runtime, {
  lateral: { enabled: true },
  jsonAgg: { enabled: true },
});
```

— a shape that matches what `selectIncludeStrategy` looks for but **not** what real emitted contracts produce. So the `'lateral'` / `'correlated'` branches of the dispatcher are dead code in practice.

### Concrete demo evidence

A trivial 2-level query with no combine, no count, no nested args:

```graphql
{ users { comments { body } } }
```

Should resolve in one SQL statement (correlated subquery + jsonAgg). Actually fires two:

```sql
-- query 1
SELECT "user"."id" AS "id" FROM "user"
-- query 2
SELECT "comment"."body" AS "body", "comment"."authorId" AS "authorId" FROM "comment"
WHERE "comment"."authorId" IN (?, ?)
```

### Cost

- **Demo: works**, but every demo response shows N+1 query counts to the audience. The Pothos author *will* notice.
- **Real prisma-next users**: every relation-loading workload pays the multi-query overhead, even targets that could otherwise do correlated/lateral subqueries.
- This is a much bigger blast radius than I initially attributed to D-4 (combine-only) — D-4 is a special case of W-8.

### The fix that landed

`selectIncludeStrategy` now reads capability flags from the contract's `targetFamily` and `target` namespaces — the two layers the contract emitter actually populates:

```ts
function capabilityFlag(contract: Contract<SqlStorage>, flag: string): boolean {
  return (
    contract.capabilities[contract.targetFamily]?.[flag] === true ||
    contract.capabilities[contract.target]?.[flag] === true
  );
}
```

Cross-namespace false positives ("postgres.lateral found while running SQLite") are impossible by construction — only the running target's namespaces are inspected.

The previous version of this entry sketched a `flagAcross` helper that searched all namespaces. That was rejected during review as too loose; the principled namespaced version is what shipped.

### Action item

✅ **Fixed in `fix/orm-client-include-strategy` (PR #425).** This subsumes W-3 / D-4 in priority — fixing W-8 makes simple nested includes one query. Combine still falls back due to the separate `hasComplexIncludeDescriptors` check (D-4); deep nesting still falls back due to `hasNestedIncludes` (Issue A in `issues.md`). Both are documented as separate follow-ups.

---

## W-7: Manual `Promise<unknown>` wrap on `t.prismaField` resolver result for M2 reshape

### What

The plugin's `wrapResolve` for `t.prismaField` now `await`s the user's resolver result before applying the reshape. If the user's resolver returns a non-promise (e.g., synchronous), this still works because of `await`'s identity behaviour, but the plugin's outer wrapper became `async (parent, args, ctx, info) => ...` instead of just returning the resolver's call result.

### Why

In M1, the plugin returned the resolver's promise directly. M2 needs to apply the reshape function *after* the result resolves. So the wrapper became:

```ts
const result = await resolver(collection, parent, args, context, info);
if (result == null) return result;
return Array.isArray(result) ? result.map(reshape) : reshape(result);
```

### How

Marked the wrapper `async`. GraphQL is fine with promise-returning resolvers; no behavior change for users.

### Cost

- **Demo: works.**
- **v2 plugin: same pattern.** A v2 might want to skip the await when no reshape is needed (`reshape === noopReshape`) for a tiny perf win.

### Action item

In v2, conditionally skip the await/reshape wrap when the walker returns `noopReshape`. Currently the wrapper always runs.

---

## W-9: sqlite adapter has no `booleanColumn` / `sqlite/bool@1` codec

### What

The sqlite adapter (`packages/3-targets/6-adapters/sqlite`) exposes `textColumn / integerColumn / realColumn / blobColumn / datetimeColumn / jsonColumn / bigintColumn` (`src/exports/column-types.ts:1-9`). No boolean. Postgres has the equivalent (`boolColumn` + `pg/bool@1` codec). Demo's `Post.published` is declared `integerColumn` because there's no other choice, so the row decodes to `number` and the GraphQL surface is honest about that with `t.exposeInt('published')` (returns 0 or 1).

### Why it surfaced here

I went around in circles because I was treating "GraphQL wants Boolean but the row is Int" as a plugin problem to paper over with custom resolvers + extension plumbing. It isn't — the contract is the source of truth and the surface should follow it. With a real boolean codec the field is `t.exposeBoolean('published')` and Pothos's `CompatibleTypes` accepts it; without one, the right move is to expose the int.

### How — the action item

Add to `packages/3-targets/6-adapters/sqlite`:

1. `SQLITE_BOOL_CODEC_ID = 'sqlite/bool@1'` in `src/core/codec-ids.ts`.
2. `booleanColumn = { codecId: SQLITE_BOOL_CODEC_ID, nativeType: 'integer' }` in `src/core/column-types.ts`, re-exported.
3. Codec definition (decode int → boolean, encode boolean → int 0/1) in the sqlite codec registry.
4. Native-type mapping update so the introspector / migrator recognises it.

Cost: small. Postgres's `bool` codec already exists as a reference. Once it lands, the demo's `Post.published` goes back to `t.exposeBoolean('published')` with no plugin-side changes.

### Cost

- **Demo today**: `t.exposeInt('published')` is honest but the GraphQL surface is `Int!` rather than the more natural `Boolean!`.
- **Real users**: anyone using sqlite + booleans has to encode/decode manually (or use `t.field({ select: { col: true }, ... })` with a JS coercion).

---

## Open issues to flag back to the team

Summary of prisma-next-side gaps surfaced by building the demo:

1. **W-8 (orm-client)** ✅ **fixed in this branch**: `selectIncludeStrategy` looks for capability flags at the wrong level of `contract.capabilities`. Falls back to `'multiQuery'` for every emitted contract. Fix landed; `users { comments { body } }` is now 1 SQL query. Real bug, affected all prisma-next orm-client users.
2. **Issue A (orm-client)** — `hasNestedIncludes` short-circuit forces depth-2+ to multi-query. Detailed walkthrough in [`issues.md`](./issues.md#issue-a--hasnestedincludes-short-circuit). **Real bug, real perf cost. ~1-2 weeks of work, plus an ADR.**
3. **Issue B (orm-client)** — `hasComplexIncludeDescriptors` short-circuit forces every `combine`/`scalar` include to multi-query. Detailed walkthrough in [`issues.md`](./issues.md#issue-b--hascomplexincludedescriptors-short-circuit-combine--scalar). **Real bug** — additional fallback on top of W-8 — but the fix has a real correctness landmine (SQL aggregation semantics differ from the current JS-side reduction for some codecs). ~3-7 days plus an ADR.
4. **W-1 (orm-client)**: nested-stitch FK augmentation is depth-1 only; should recursively descend into `state.includes` and add their `localColumns`. Real bug. Subsumed by Issue A's fix (the single-query path doesn't have this problem because all FK columns are emitted into one statement).
5. **Misc**: `db.sql.X.insert([row, row])` (multi-row insert) doesn't exist; only single-row. Minor seeding ergonomics.
6. **Misc**: import path for `SqlMiddleware` is `@prisma-next/sql-runtime` (root), not `@prisma-next/sql-runtime/middleware` as I expected. Worth a re-export or doc nudge.
