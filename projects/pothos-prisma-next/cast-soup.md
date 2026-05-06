# Walker cast soup

The auto-include walker chains Collection methods (`.select`, `.include`, `.combine`, `.count`) on a value whose declared type can't accept those calls. So every method invocation gets wrapped in an `as unknown as { method: ... }` cast that re-asserts the shape inline. ~10 such casts in `examples/pothos-integration/src/plugin/auto-include.ts`.

This is plugin-side, not orm-client. The orm-client's Collection API is correctly typed; the plugin's own type plumbing throws away the information needed to use it.

## Root cause

The walker types its accumulator as `AnyCollection`:

```ts
// auto-include.ts:92
type AnyCollection = Collection<Contract<SqlStorage>, string, unknown, never>;
```

Those four type parameters look harmless but they pin the Collection to the *least informative* possible instantiation:

- `Contract<SqlStorage>` — generic contract, no model metadata
- `string` — model name unknown
- `unknown` — row shape unknown
- `never` — type-state slot collapsed

The real `Collection<C, M, R, S>` overloads on `.select(...)` and `.include(...)` are parametric in column tuples, related-model name, and to-many cardinality. With the parameters pinned to `string`/`unknown`/`never`, overload resolution can't pick a usable signature, so `acc.select(...)` and `acc.include(...)` don't typecheck on `acc: AnyCollection`. Hence the casts.

## Concrete examples

### `.select(...)` — `auto-include.ts:220-225`

```ts
if (allSelectFields.size > 0) {
  const sel = (acc as unknown as { select: (...names: string[]) => AnyCollection }).select;
  if (typeof sel === 'function') {
    acc = sel.apply(acc, [...allSelectFields]);
  }
}
```

Reads: "pretend `acc` has a `.select` method taking strings and returning another `AnyCollection`, then call it." The `typeof sel === 'function'` guard exists because the type assertion is a lie — at runtime the method might not exist on this shape, so the code defends against itself.

### Plain `.include(rel, refineFn)` — `auto-include.ts:233-237`

```ts
acc = (
  acc as unknown as {
    include: (n: string, refine?: (rel: AnyCollection) => AnyCollection) => AnyCollection;
  }
).include(plan.relationName, (rel) => walk.apply(rel));
```

Same pattern: re-assert the shape, call the method. Note the inner `rel` parameter is also `AnyCollection`, so the cast tax recurs every time the inner walker tries to chain on `rel`.

### `.include(rel, p => p.combine({...}))` — `auto-include.ts:242-257`

```ts
acc = (
  acc as unknown as {
    include: (n: string, refine?: (rel: AnyCollection) => AnyCollection) => AnyCollection;
  }
).include(plan.relationName, (rel) => {
  const spec: Record<string, unknown> = {};
  for (const [alias, { walk }] of plan.rowAliases) {
    spec[alias] = walk.apply(rel);
  }
  for (const alias of plan.countAliases) {
    spec[alias] = (rel as unknown as { count: () => unknown }).count();             // ← cast
  }
  return (
    rel as unknown as { combine: (s: Record<string, unknown>) => AnyCollection }    // ← cast
  ).combine(spec);
});
```

Three casts in one expression: outer `.include`, inner `.count`, inner `.combine`.

## Why it's bad

1. **The casts lie about the method shape.** `(acc as unknown as { select: ... })` tells TypeScript "trust me, this object has this method." If a future orm-client refactor renames `.select` to `.project`, the runtime breaks but TypeScript stays silent — the cast claims `.select` exists regardless.

2. **The result types are also lies.** The casts assert `.select(...)` returns `AnyCollection`. The real return type is a *narrower* Collection where the row shape reflects the selected columns. The walker throws away that narrowing.

3. **Inner-method calls in callbacks pay the same tax.** Every refine callback receives a `rel: AnyCollection` parameter that needs the same casts to be useful. So even if you fix the outer accumulator, the inner ones still need them.

4. **`as unknown as` is the strongest cast TypeScript offers.** Direct `acc as { select: ... }` would fail because `Collection<...>` and `{ select: ... }` aren't structurally compatible. `as unknown as` launders through `unknown` to bypass that check entirely. Project conventions in `CLAUDE.md` flag this as a last-resort pattern that should always be commented — these aren't.

## The fix

Thread the user's typed contract through the walker so the Collection's type parameters can be real:

```ts
// hypothetical
type WalkerCollection<TContract extends Contract<SqlStorage>, M extends string> =
  Collection<TContract, M, DefaultModelRow<TContract, M>, DefaultCollectionTypeState>;

function walkSelection<TContract extends Contract<SqlStorage>, M extends string>(
  type: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  // ...
): {
  apply: (c: WalkerCollection<TContract, M>) => WalkerCollection<TContract, M>;
  reshape: Reshape;
};
```

With concrete type parameters, Collection's overloads resolve normally. The casts collapse into typed accesses.

## Why it isn't fixed already (the dependency chain)

The walker doesn't know what model it's walking, so it can't type the Collection more precisely. The plugin's own code can't see the user's contract type at the call site, because of how `SchemaBuilderOptions.prismaNext` is declared:

```ts
// global-types.ts:166-171
export interface SchemaBuilderOptions<Types extends SchemaTypes> {
  prismaNext: PrismaNextPluginOptions<Contract<SqlStorage>> & { _types?: Types };
  //                                  ^^^^^^^^^^^^^^^^^^^^
  //                                  Loose default, NOT Types['PrismaNextContract']
}
```

The user-supplied typed `Contract` is reachable as `Types['PrismaNextContract']`, but the options interface uses the loose `Contract<SqlStorage>`. The comment at the call site calls this out explicitly:

```ts
// Types is reachable as PothosSchemaTypes via the augmentation
// mechanism; we keep `Contract<SqlStorage>` as a permissive default
// rather than threading the per-builder PrismaNextContract through.
```

That concession is the parent of this whole problem.

## Fix order

These three findings from `reviews/code-review.md` are the same problem with three symptoms — fix in this order:

1. **F06** — Thread `Types['PrismaNextContract']` through `SchemaBuilderOptions.prismaNext`. With the typed contract reachable at every call site, both `db` and `contract` become typed.
2. **F10** — Replace `auto-include.ts:382-393`'s `(buildCache as unknown as { builder: ... }).builder.options.prismaNext.contract` reach-in by passing the contract into `applySelectionToCollection` as an explicit parameter from the plugin's `wrapResolve` (which already has `this.builder` in scope).
3. **F09** — Re-type the walker's accumulator as `WalkerCollection<TContract, M>` (or equivalent). Delete every `as unknown as { ... }` cast on Collection methods. The `typeof sel === 'function'` runtime guards become dead code; delete those too.

Step 1 is required for steps 2 and 3 to land cleanly. None of them changes runtime behavior — they're a pure typing improvement that makes future refactors of the orm-client's Collection API surface in the plugin instead of silently breaking it.

## Affected sites (inventory)

For the implementer — every cast in the walker that goes away once F06/F10/F09 land:

| Line | Method | Form |
|---|---|---|
| `auto-include.ts:221` | `.select` | `(acc as unknown as { select: (...) => AnyCollection }).select` |
| `auto-include.ts:233-237` | `.include` (plain) | `(acc as unknown as { include: ... }).include(...)` |
| `auto-include.ts:242-246` | `.include` (combine) | `(acc as unknown as { include: ... }).include(...)` |
| `auto-include.ts:252` | `.count` | `(rel as unknown as { count: () => unknown }).count()` |
| `auto-include.ts:254-256` | `.combine` | `(rel as unknown as { combine: ... }).combine(...)` |
| `auto-include.ts:387-393` | contract reach-in | `(buildCache as unknown as { builder: { options: { prismaNext: { contract: ... } } } }).builder` |

Plus a handful of related casts in `index.ts` (`opts.db as unknown as Record<string, unknown>` at `index.ts:30`) and `prisma-object-field-builder.ts` (`(this.contract as { models: ... }).models` at lines 112, 139) that share the same root cause.
