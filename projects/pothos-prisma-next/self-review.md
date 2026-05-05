# Self-review

Critical pass over what I shipped on this branch, organized by severity. Goal: surface things that would bite a real user, things a code reviewer would flag, and the design questions I deferred. Intentionally honest about limitations rather than defensive.

Two artifacts to review:

1. The **W-8 fix** in `packages/3-extensions/sql-orm-client/src/include-strategy.ts` (a real prisma-next change).
2. The **pothos-integration demo plugin** at `examples/pothos-integration/src/plugin/` (~550 LOC of plugin code + walker + reshape).

---

## W-8 fix — `selectIncludeStrategy`

The fix landed and works for the headline case (`users { comments { body } }` is now 1 query instead of 2). But the implementation has three real concerns and one missing test.

### Critical: namespace-blind detection (latent bug)

The fix iterates `Object.values(capabilities)` looking for the flag in any namespace. That's right for the common case but **wrong if a contract carries capability flags for namespaces that don't apply to the running runtime**.

Example: imagine someone hand-crafts a contract for SQLite but copy-pastes a `postgres: { lateral: true }` entry. My code returns `'lateral'` because some namespace has the flag. The runtime then tries to emit LATERAL syntax against SQLite — which has no LATERAL — and the SQL fails.

**In practice** this probably doesn't bite because the emitter generates target-specific contracts. But it's a latent foot-gun. Fix:

```ts
export function selectIncludeStrategy(
  contract: Contract<SqlStorage>,
  // Pass the runtime's effective target (the SQL family + adapter target).
): IncludeStrategy {
  // Only consider capability namespaces matching the running target.
  // Drop the bare-everywhere recursion.
}
```

This needs a small ergonomics call: should `selectIncludeStrategy` know the target, or should the dispatcher filter capabilities before handing them in? Either way the namespace-blind iteration is wrong long-term.

**Severity**: low *today*, high *eventually*. Worth flagging in the followup ticket.

### Critical: pre-existing `hasCapability` quirk now amplified

`hasCapability` (unchanged from before my fix):

```ts
function hasCapability(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'object' || value === null) return false;
  const flags = value as Record<string, unknown>;
  return Object.values(flags).some((flag) => flag === true);
}
```

That last branch returns `true` for any object containing at least one `true` value. Designed for the test fixture shape `{ enabled: true }`. But also matches:

```ts
{ lateral: { enabled: false, debug: true } } // returns true!
{ jsonAgg: { reason: "currently unsafe; do not use", flag: true } }  // returns true!
```

Before my fix this only mattered for top-level capabilities. After my fix, the same quirk is checked one namespace deeper too, so the over-trigger surface doubled.

The honest fix is for `hasCapability` to look for an explicit `enabled: true` rather than any `true` value, but that breaks the existing tests that pass `{ lateral: true }` directly. Real fix: drop the "any object with any true" branch and require either `value === true` or `value?.enabled === true`. Worth a separate cleanup PR.

**Severity**: medium. Real bug surface but only triggers for unusual capability shapes.

### Real concern: explicit `false` is silently overridden by nested truthy

If someone writes:

```ts
capabilities: {
  lateral: false,           // explicit "off"
  sql: { lateral: true },   // nested "on"
}
```

My fix returns `true`. Top-level: `hasCapability(false)` returns false → falls through to iteration → finds the nested `true`.

That's almost certainly wrong: an explicit top-level `false` should be a hard "no". Fix: short-circuit on top-level `false`:

```ts
if (capabilities[flag] === false) return false;       // explicit off wins
if (hasCapability(capabilities[flag])) return true;   // top-level truthy
// then the namespace iteration
```

**Severity**: low (no real contract puts conflicting flags). But the semantics are unprincipled.

### Missing test

I didn't add a test asserting `{ sql: { lateral: false, jsonAgg: true } }` returns `'correlated'` (not `'lateral'`). Easy to add; would catch any future regression around explicit `false` semantics.

### What's good

- TDD: I wrote 3 failing tests for the emitted-shape case before applying the fix.
- The 6 pre-existing tests all pass; no behavioural regression on the canonical shape.
- The 3 tests I had to update were *implicitly verifying the bug*, not the intended behaviour. Documenting that in the commit message was the right call.
- Localized change: no changes to dispatch logic, no API surface change.

---

## Demo plugin — `auto-include.ts`

The walker is the core of the plugin. ~470 lines, no unit tests, verified end-to-end via the demo. Some real concerns.

### Critical: zero unit tests

The whole module has no direct tests. The smoke test via GraphiQL covers the headline cases but doesn't pin down behaviour for:

- Single-relation, single field → plain include (covered by demo)
- Single-relation, two GraphQL fields → combine (covered by demo)
- Single-relation with `relationCount` only (no peer rows) → combine with single count branch (NOT covered)
- Single-relation with aliased GraphQL field name (`myPosts: t.relation('posts')`) (NOT covered)
- Combine + nested relations on the combine branches (NOT covered — does the reshape recurse correctly?)
- Empty relation result (`null` for to-one, `[]` for to-many) — coercion semantics (NOT covered)
- The `aliasDiffers` lift path in `buildReshape` (lines 386-405) — added defensively, never exercised

A v2 plugin needs direct tests. As-is, refactoring this module is risky.

**Severity**: high for any production use. Fine for a same-day demo.

### Critical: assumption that GraphQL field name === prisma-next field name === storage column name

The walker calls `.select(scalarFieldName)` directly using the GraphQL field name in the selection set:

```ts
// auto-include.ts:289
scalarFields.add(sel.name.value);
```

If a user's prisma-next contract maps a model field to a different storage column (e.g. via `@map("first_name")`), the field-level `.select('firstName')` resolves to that column via the orm-client's contract lookup. Good.

But if the user's GraphQL schema renames the field — e.g. they expose `t.field({ type: 'String', resolve: parent => parent.firstName })` under a GraphQL field called `name` — the walker adds `name` to `.select(...)`, which the contract doesn't know about. The orm-client throws.

Today the demo schema sidesteps this by using GraphQL field names that match prisma-next field names. Real users won't always.

Fix: the field config needs to carry the *prisma-next field name* explicitly, and the walker should consult it:

```ts
extensions: {
  [PRISMA_NEXT_SELECT_FIELD]: { fieldName: 'firstName' },  // not just the column
}
```

Then `t.exposeString` and any field whose resolver reads `parent.<x>` should set this extension. The walker reads it; falls back to `sel.name.value` only when absent.

**Severity**: high once anyone tries to expose a field under a different GraphQL name.

### Real concern: `PRISMA_NEXT_SELECT_FIELD` is dead code in the demo

I declared the constant in `types.ts` and handled it in `wrapResolve` (`index.ts:101-104`), but no field-builder code ever sets it. The demo uses `t.field({ type, resolve: ... })` everywhere instead, which doesn't go through this path.

So the entire `PRISMA_NEXT_SELECT_FIELD` branch is unreachable in the demo. Two options:

- Delete the constant + wrapResolve branch + types entry. Keep the plugin honest about what it actually does.
- Wire it up properly via a real `t.exposeString`/etc. that adds it. (This depends on solving W-2 — per-model parent shape — to make exposeX typecheck.)

I'd lean towards delete now and re-add when the typed parent shape lands.

**Severity**: medium — it's dead code that signals capability the plugin doesn't actually have.

### Real concern: cast soup

The walker has ~10 `(acc as unknown as { method: ... }).method(...)` casts. Each one loses type safety on a Collection method call. This is because `Collection`'s real `.select(...)`/`.include(...)` signatures have tuple types that don't compose with the walker's `unknown`-typed flow.

Pragmatic for a demo. But every cast is a place where a future refactor of the orm-client's Collection API would silently break. A v2 should commit to typed Collection chains and remove every cast.

**Severity**: low correctness risk, medium maintenance risk.

### Real concern: walker is O(depth × fields × relations) per request

`walkSelection` recurses for every relation field's subtree, computing both `apply` and `reshape` eagerly. For a wide query (10 relations each with 5 nested fields), this walks the whole subgraph for each relation independently. Probably fine for any realistic GraphQL query — schemas don't have hundreds of fields per type — but it's worth noting.

The reshape phase is similar: `buildReshape` walks `groupPlans`, each of which carries a child `walk.reshape` already computed. No redundant work there. But the eager closure construction means a query that turns out to have empty-result relations still pays for the closure setup.

**Severity**: very low.

### Style: `await` + `Array.isArray(result) ? result.map(reshape) : reshape(result)` always runs

In `wrapResolve` for `prismaField` (`index.ts:46-57`):

```ts
const result = await (resolver as ...)(collection, parent, args, context, info);
if (result == null) return result;
return Array.isArray(result) ? result.map((row) => reshape(row)) : reshape(result);
```

Even for queries where `reshape === noopReshape` (no combines anywhere), the wrapper still awaits and re-traverses the result array. Marginal perf cost, but real for high-throughput servers. A v2 should fast-path:

```ts
if (reshape === noopReshape) return resolver(...);
```

**Severity**: very low.

### What's good

- Clean separation of `apply` (runtime) and `reshape` (per-row, post-resolve). The two functions can be tested independently.
- `noopReshape` identity is preserved through `makeListOrObjectReshape` (early return on line 459) so the chain doesn't grow useless wrappers.
- The combine emission rule is explicit: 1 row field + 0 counts + alias === relationName → plain. Anything else → combine. Easy to reason about.
- The W-1 workaround (FK auto-augmentation) is well-commented and references the issue doc.

---

## Demo plugin — `index.ts` (`wrapResolve`)

### Real concern: `info.fieldName in p` is too permissive

```ts
// index.ts:72
const value = info.fieldName in p ? p[info.fieldName] : p[relation.relationName];
```

Uses `in` which checks the prototype chain. If `parent` somehow has `Object.prototype.toString` exposed via `info.fieldName` (or any key on the prototype), this returns the prototype function instead of falling back to the relation key.

Probably won't bite for plain row objects, but `Object.prototype.hasOwnProperty.call(p, info.fieldName)` would be more correct.

**Severity**: low — only matters with very weird parent shapes.

### Real concern: no fail-fast on schema build

`prismaObject('NoSuchModel', {...})` doesn't validate that the model exists in the contract. The error surfaces later when:

- `t.relation` is called inside the fields callback → `#getRelationMeta` throws "Model not found"
- OR no relations exist → schema builds silently, then queries fail at resolve time

Both are confusing failure modes. The fix is one line in `schema-builder.ts`:

```ts
if (!(modelName in builderOpts.prismaNext.contract.models)) {
  throw new Error(
    `[pothos-prisma-next] prismaObject('${modelName}'): no such model in contract.`,
  );
}
```

Same applies to `t.prismaField({ type: 'NoSuchModel' })` — no build-time check today.

**Severity**: low (clear errors are nice but the buggy path is "obvious typo").

### What's good

- The dispatch is single-path: read the extension, branch on what kind of field config this is. Easy to read.
- The fallback error for `t.relation` reached outside `t.prismaField` is clear and actionable.
- The reshape is applied at the boundary of the user's resolver, not inside the orm-client. Keeps the orm-client untouched.

---

## Demo plugin — `schema-builder.ts` and `prisma-object-field-builder.ts`

### Real concern: `prismaObject` doesn't pass through arbitrary Pothos object options

```ts
// schema-builder.ts:45-55
.objectType(ref, {
  description: opts.description,
  extensions: { ... },
  fields: opts.fields ? () => opts.fields?.(...) : undefined,
  name: modelName,
});
```

Only `description`, `fields`, and `extensions` are forwarded. If the user passes `interfaces`, `isTypeOf`, `pothosOptions` — anything else from `ObjectTypeOptions` — it's silently dropped.

Pothos-prisma forwards everything via `...options`. My implementation is more restrictive without warning. Fix: spread `opts` rather than enumerate.

**Severity**: medium for real users; low for the demo (which uses none of the dropped options).

### Real concern: `getOrCreateModelRef` cast loses type information

The ref cache returns `unknown`; `prismaObject` returns it as `never`. So:

```ts
const Post = builder.prismaObject('Post', { ... }); // type: never
```

Doesn't help users do anything typed with the returned ref. Fine for the demo (we don't use the ref for type narrowing) but a v2 should return a properly-typed `ObjectRef<Types, ModelRow<Contract, 'Post'>>`.

**Severity**: low.

### What's good

- Custom field builder pattern (`PrismaNextObjectFieldBuilder extends ObjectFieldBuilder`) is structurally faithful to plugin-prisma's pattern.
- Relation metadata is resolved at registration time, not at field-build time → fail-fast on unknown relation names.
- WeakMap-keyed ref cache is the right shape (one cache per builder instance, garbage-collected with the builder).

---

## Cross-cutting

### Critical: hidden assumption about field name === model field name

This shows up in two places:

1. The walker (`auto-include.ts:289`) adds `sel.name.value` (the GraphQL field name) directly to `.select(...)`.
2. The wrapResolve for relation/relationCount uses `info.fieldName` to read `parent[info.fieldName]`.

Both assume the GraphQL field name matches the prisma-next model field name. The demo schema satisfies this. Real users frequently won't — they rename fields for naming conventions, hide internal columns, expose computed values, etc.

A v2 should make every `t.exposeX`/`t.relation`/`t.relationCount` register an explicit `(graphqlFieldName, prismaFieldName)` mapping and have the walker + resolver consult it.

**Severity**: high for production, fine for a demo.

### Real concern: type-level looseness

`prismaObject` returns `unknown`, not a typed ref. Resolver `parent` is `Record<string, unknown>`. Type tests are completely absent from the plugin. So:

- Field resolvers cast `parent` everywhere.
- Refactoring is unsafe.
- Editor autocomplete is useless inside resolvers.

This is W-2 + D-3 in the workarounds doc — known and intentional. But someone reviewing the demo code without context will see a lot of `as Record<string, unknown>` and reasonably worry. Worth re-stating the rationale in the README under a "Why the verbose `t.field` calls?" section.

### Style: capture middleware double-buffers when reshape is a noop

The capture middleware records every SQL execution to an ALS-scoped array, then the server attaches it to response extensions. Independent of reshape. Still works correctly when reshape is a noop. No real concern; just noting that the two systems are independent.

### What's good

- The capture middleware is the cleanest piece of the demo — one file, ~70 LOC, scoped via AsyncLocalStorage, well-documented.
- The graphql-yoga server plugin shape matches Yoga's documented extension pattern.
- The README is honest about scope, with explicit non-goals.
- `workarounds.md` and `issues.md` together cover every meaningful trade-off the next person encountering this code would care about.

---

## Summary by severity

| # | Concern | File | Severity |
|---|---|---|---|
| 1 | W-8: namespace-blind detection (cross-target leakage) | `include-strategy.ts:31-45` | low today, high eventually |
| 2 | W-8: `hasCapability` over-permissive nested-object branch (pre-existing, amplified) | `include-strategy.ts:47-58` | medium |
| 3 | W-8: explicit top-level `false` doesn't override nested `true` | `include-strategy.ts:36-43` | low |
| 4 | W-8: missing test for explicit-false-wins-nested-true | `include-strategy.test.ts` | low |
| 5 | Walker: zero unit tests | `auto-include.ts` | high |
| 6 | Walker: assumes GraphQL field name === prisma-next field name | `auto-include.ts:289`, `index.ts:72` | high (production) |
| 7 | Walker: `PRISMA_NEXT_SELECT_FIELD` is dead code in the demo | `auto-include.ts`, `index.ts:101-104` | medium |
| 8 | Walker: cast soup loses Collection method type safety | `auto-include.ts` (10+ call sites) | medium (maintenance) |
| 9 | Walker: O(depth × fields × relations) per request | `auto-include.ts:107-225` | very low |
| 10 | wrapResolve: always awaits + maps even when reshape is noop | `index.ts:42-58` | very low |
| 11 | wrapResolve: `info.fieldName in p` walks prototype chain | `index.ts:72` | low |
| 12 | schema-builder: no fail-fast on unknown model name | `schema-builder.ts:39` | low |
| 13 | schema-builder: drops most ObjectTypeOptions silently | `schema-builder.ts:45-55` | medium |
| 14 | schema-builder: ref returned as `unknown` (not usable for type narrowing) | `schema-builder.ts:57` | low |

**Two critical fixes for any v2:**

- **#5**: write tests for the walker. Without them, refactoring is gambling.
- **#6**: thread the prisma-next field name explicitly through field-config extensions, don't rely on GraphQL field name === model field name.

**One immediate cleanup that wouldn't take long:**

- **#7**: delete the `PRISMA_NEXT_SELECT_FIELD` dead-code branch (or wire it up properly).

Everything else is bounded to demo-only impact and either documented in `workarounds.md` already or low-cost to address when this work goes upstream.
