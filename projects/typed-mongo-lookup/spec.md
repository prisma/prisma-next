# Summary

Re-shape `PipelineChain.lookup(...)` in `@prisma-next/mongo-query-builder` so its inputs use a callback-based selection pattern (matching `group()` and other accessor-driven stages) and its output threads the foreign collection's row type forward into `Shape`. The simple equality `$lookup` form is the only form in scope.

# Context

## At a glance

`lookup()` is the one stage in the Mongo query builder that fails the project's type-safety standards: bad inputs silently compile, and the result row erases the foreign element type. The fix is to replace its options-object signature with the callback-based pattern the rest of the builder already uses, and to extend the `DocField` vocabulary so `Shape` can carry "an array of foreign-model rows" precisely enough that `ResolveRow` produces `ForeignRow[]` instead of `unknown[]`.

Before / after on the example query in [`examples/mongo-blog-leaderboard/src/queries.ts`](../../examples/mongo-blog-leaderboard/src/queries.ts):

```ts
// Today
db.query
  .from('posts')
  .group(...)
  .sort({ postCount: -1 })
  .lookup({
    from: 'users',         // typed against roots, but bad strings still compile (silent fallback)
    localField: '_id',     // typed against current Shape
    foreignField: '_id',   // bare string — any value compiles
    as: 'author',
  })
  .build();
// rows[0].author : unknown
```

```ts
// Target
db.query
  .from('posts')
  .group(...)
  .sort({ postCount: -1 })
  .lookup((col) => ({
    from: col.users,
    on: (local, foreign) => ({
      local: local._id,
      foreign: foreign._id,
    }),
    as: 'author',
  }))
  .build();
// rows[0].author : Array<{ _id: string; name: string; email: string; bio: string | null; address: AddressOutput | null }>
```

Every input is selected from a typed surface (`col.X`, `local.X`, `foreign.X`); typos are property-access errors, not constraint-fallback misses. The runtime `$lookup` emitted is unchanged — same `MongoLookupStage` with the same `from` / `localField` / `foreignField` / `as` strings, extracted from the typed handles.

## Problem

The current `lookup()` signature lives at [`packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts` L269–L304](../../packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts:269-304):

```ts
lookup<ForeignRoot extends keyof TContract['roots'] & string, As extends string>(options: {
  from: ForeignRoot;
  localField: keyof Shape & string;
  foreignField: string;
  as: As;
}): PipelineChain<
  TContract,
  Shape & Record<As, { readonly codecId: 'mongo/array@1'; readonly nullable: false }>,
  ...
>
```

Three concrete safety gaps observed against this signature on a real example (`examples/mongo-blog-leaderboard/src/sample.ts` with deliberate typos in every input):

1. **`from` doesn't error on a bad root.** `from: 'usexxxrs'` compiles. The `keyof TContract['roots']` constraint is on a generic parameter, and TypeScript falls back when sibling-property errors (`localField`) are also present rather than reporting both. Verified by `pnpm typecheck` in the example: only `localField` errors.
2. **`foreignField` is bare `string`.** Any literal compiles. This is the most common typo site in real `$lookup` code because the user is naming a field on a model they aren't currently looking at.
3. **The result row is `unknown[]`.** The `as` slot is encoded as `{ codecId: 'mongo/array@1', nullable: false }` — a sentinel saying "this field is an array" with no element-type information. `ResolveRow` walks the codec and produces `unknown[]`. The downstream test at [`examples/mongo-blog-leaderboard/test/leaderboard.test.ts` L51](../../examples/mongo-blog-leaderboard/test/leaderboard.test.ts:51) currently force-casts `top.author as Array<{ name: string }>` to recover any typing.

The runtime cost of (1) and (2) is the worst kind: typoed lookups don't throw — they pass through to MongoDB, which happily executes a join that no documents match, and returns empty arrays. The existing type test at [`builder.test-d.ts` L79–L94](../../packages/2-mongo-family/5-query-builders/query-builder/test/builder.test-d.ts:79-94) doesn't cover bad `from` / bad `foreignField`, which is how the gap survived. The result-typing test at the same file's L230–L249 actively asserts `customer: unknown[]` — i.e. the current behaviour is locked in by tests that need to be flipped.

## Approach

### API shape

Replace the options-object signature with a single outer callback. The callback receives a `col` accessor that exposes one entry per root in the contract; the call returns an options literal whose `from` is selected from `col`, whose `on` is itself a callback receiving `(local, foreign)` field accessors, and whose `as` is a fresh string label invented by the caller:

```ts
.lookup((col) => ({
  from: col.users,
  on: (local, foreign) => ({
    local: local._id,
    foreign: foreign._id,
  }),
  as: 'author',
}))
```

Type-flow rationale (the design discussion settled these; recording for the implementer):

- **`col.X` is property access on a concretely-typed object**, not generic inference. The structural typo-fallback bug observed on today's `from` cannot recur on a property-access surface.
- **`local` is the existing `FieldAccessor<Shape, N>`** over the current pipeline shape — same accessor `match`, `addFields`, `group`, `sort`, etc. already use.
- **`foreign` is a fresh `FieldAccessor<ModelToDocShape<TC, RootOf<typeof from>>, NestedDocShape>`** built from the foreign root selected via `col`. Its key set is the foreign model's storage-name fields; `foreign._idxx` is a property-access error.
- **`on`'s return is the named-key form** `{ local, foreign }`, not a positional tuple. The keys disambiguate which side is which at the call site.
- **`as` stays a raw string by necessity** — it's a new field name the caller is inventing, not selecting from an existing surface.

### Result encoding

Extend `DocField` with a new variant for "array of foreign-model rows", parallel to the existing `ObjectField<NestedDocShape>` at [`resolve-path.ts` L20–L24](../../packages/2-mongo-family/5-query-builders/query-builder/src/resolve-path.ts:20-24):

> _Illustrative — exact shape and naming up to the implementer:_
>
> ```ts
> interface ModelArrayField<ModelName extends string> extends DocField {
>   readonly codecId: 'prisma/modelArray@1';
>   readonly nullable: false;
>   readonly model: ModelName;
> }
> ```

`ResolveRow` gains a case ahead of the codec lookup that detects the variant and resolves it to `ResolveRow<ModelToDocShape<TC, ModelName>, CodecTypes>[]`. This requires `ResolveRow` to thread the contract (or its codec types — already threaded — plus the contract itself) so it can dereference `ModelName` against `TContract['models']`.

The `MongoLookupStage` AST is unchanged. The runtime extracts strings from the typed handles (`from = col.X.<root>`, `localField = local.<x>._path`, `foreignField = foreign.<y>._path`, `as` = the literal) and constructs the same stage today's code constructs.

### Marker behaviour

Unchanged. `$lookup` continues to clear `UpdateEnabled` and `FindAndModifyEnabled` and flip `LeadingMatch` to `'past-leading'`, per the marker table in [ADR 201 §4](../../docs/architecture%20docs/adrs/ADR%20201%20-%20State-machine%20pattern%20for%20typed%20DSL%20builders.md). The `N` parameter is preserved (the lookup adds a sidecar field; it doesn't rewrite the document).

### Migration

No backward-compat shim. The existing `lookup({...})` call sites are updated to the new callback shape:

- [`examples/mongo-blog-leaderboard/src/queries.ts` L22–L27](../../examples/mongo-blog-leaderboard/src/queries.ts:22-27) (production)
- [`examples/mongo-blog-leaderboard/src/sample.ts` L22–L27](../../examples/mongo-blog-leaderboard/src/sample.ts:22-27) (intentional-typo demo) — should be updated to demonstrate the new shape, with one variant per gap (`col.usexxxrs`, `local._idxx`, `foreign._idxx`) committed as `// @ts-expect-error`-annotated examples or removed if the type tests below cover them adequately.
- [`packages/2-mongo-family/5-query-builders/query-builder/test/builder.test-d.ts` L79–L94, L230–L249](../../packages/2-mongo-family/5-query-builders/query-builder/test/builder.test-d.ts:230-249) (type tests) — rewritten to the new shape; the `customer: unknown[]` expectation is replaced with the resolved foreign-row array.
- [`packages/2-mongo-family/5-query-builders/query-builder/test/builder.test.ts`](../../packages/2-mongo-family/5-query-builders/query-builder/test/builder.test.ts) (runtime tests) — updated to the new call shape.
- The package README and any `lookup`-shaped doc snippet in [`packages/2-mongo-family/5-query-builders/query-builder/README.md`](../../packages/2-mongo-family/5-query-builders/query-builder/README.md).

# Requirements

## Functional Requirements

- **FR1.** `PipelineChain.lookup` accepts a single callback parameter `(col) => Options`. The options-object signature is removed.
- **FR2.** `col` exposes one entry per `keyof TContract['roots']`, returning a typed handle (carrying the root name as a literal in the type system) usable as `Options['from']`.
- **FR3.** `Options['on']` is a callback `(local, foreign) => { local: <leaf>; foreign: <leaf> }`. `local` is the current pipeline's `FieldAccessor<Shape, N>`. `foreign` is a `FieldAccessor` over the foreign model's `ModelToDocShape`.
- **FR4.** `Options['as']` is a fresh `string` literal. The resulting `PipelineChain`'s `Shape` gains a key under that literal whose `DocField` encodes "array of rows of the foreign model".
- **FR5.** `ResolveRow` resolves the new field to `ResolveRow<ModelToDocShape<TC, ForeignName>, CodecTypes>[]`. Existing keys in `Shape` are unaffected.
- **FR6.** Marker effects on the returned `PipelineChain` are unchanged: `UpdateEnabled` cleared, `FindAndModifyEnabled` cleared, `LeadingMatch` → `'past-leading'`, `N` preserved.
- **FR7.** The emitted `MongoLookupStage` is identical to today's emission for the equivalent inputs (same `from` / `localField` / `foreignField` / `as` strings).
- **FR8.** All in-repo call sites (production examples, sample/demo files, runtime tests, type tests, README snippets) are updated to the new shape. No backward-compat shim is shipped.

## Non-Functional Requirements

- **NFR1.** Negative type tests cover at minimum: bad `col.<root>`, bad `local.<field>`, bad `foreign.<field>`, returning a non-leaf expression from `on`. Each is annotated with `// @ts-expect-error`.
- **NFR2.** A positive type test asserts the resolved row type for the simple lookup case includes the `as` field as `Array<ForeignRow>` with concrete leaf types (not `unknown[]`, not `Record<string, unknown>[]`).
- **NFR3.** The existing `mongo-blog-leaderboard` integration test passes without the `as Array<{ name: string }>` cast at [`leaderboard.test.ts` L51](../../examples/mongo-blog-leaderboard/test/leaderboard.test.ts:51); the cast is removed.
- **NFR4.** No new external dependencies. The type changes live in `@prisma-next/mongo-query-builder` and (if needed) `@prisma-next/mongo-contract` for the `ModelArrayField` variant.
- **NFR5.** No change to the wire-level command produced by `.build()` for an equivalent `$lookup` (verified by snapshot or structural test).

## Non-goals

- Advanced sub-pipeline `$lookup` form (`pipeline` + `let`). The simple equality form is the only form supported by the typed surface in this project. Users needing the advanced form continue to use the `.pipe(new MongoLookupStage(...))` escape hatch.
- Element-type-aware `unwind()` on the lookup-produced field. After `.lookup({ as: 'author' }).unwind('author')`, `author`'s type remains the existing `UnwoundShape` placeholder behaviour ([`types.ts` L107–L113](../../packages/2-mongo-family/5-query-builders/query-builder/src/types.ts:107-113)).
- Dot-path traversal into the lookup-produced field (e.g. `f('author.name')` in a downstream stage callback).
- Codec/trait-aware operator narrowing on the new `DocField` variant. Calling leaf operators (`.eq`, `.gt`, …) on the lookup field is permitted at the type level; runtime behaviour is whatever Mongo does today.
- Backward-compat for the old `lookup({...})` shape.

# Acceptance Criteria

- [ ] **AC1.** Covers FR2, NFR1: `mongoQuery<TC>(...).from('posts').lookup((col) => ({ from: col.usexxxrs, on: (l, f) => ({ local: l._id, foreign: f._id }), as: 'author' }))` produces a TypeScript error on `col.usexxxrs`.
- [ ] **AC2.** Covers FR3, NFR1: `local.<typo>` and `foreign.<typo>` each produce a TypeScript error at the property-access site.
- [ ] **AC3.** Covers FR3 negative case, NFR1: returning anything other than a leaf field reference from `on` (e.g. an aggregation expression like `local._id.toUpper()`) is rejected at the type level *or* throws a clear runtime error from `lookup()` build.
- [ ] **AC4.** Covers FR4, FR5, NFR2: a positive type test asserts that for `mongoQuery<TC>(...).from('orders').lookup((col) => ({ from: col.users, on: (l, f) => ({ local: l.customerId, foreign: f._id }), as: 'customer' })).build()`, the row type's `customer` field is `Array<UserRow>` with concrete leaf types.
- [ ] **AC5.** Covers FR6: a positive type test asserts that calling `.lookup(...)`'s downstream `PipelineChain` exposes neither `findOneAndUpdate` nor a no-arg `updateMany` (markers cleared), and `.match(...)` past the lookup remains `'past-leading'`.
- [ ] **AC6.** Covers FR7, NFR5: a runtime/structural test asserts the `MongoLookupStage` constructed by the new API matches the stage constructed by today's API for the equivalent inputs.
- [ ] **AC7.** Covers FR8, NFR3: `pnpm test:packages` and `pnpm test:integration` (or whichever suite runs the `mongo-blog-leaderboard` test) pass with the cast at [`leaderboard.test.ts` L51](../../examples/mongo-blog-leaderboard/test/leaderboard.test.ts:51) removed.
- [ ] **AC8.** Covers FR8: `pnpm typecheck` passes across the repo with no remaining call sites of the old `lookup({...})` shape.

# Other Considerations

## Security

Out of scope — this is a developer-facing API change with no auth/authz surface and no data-handling change.

## Cost

Out of scope — no infrastructure or per-request cost change. Wire-level command emission is unchanged (NFR5).

## Observability

Out of scope — no new runtime branches to instrument.

## Data Protection

Out of scope.

## Analytics

Out of scope.

# References

- [`@prisma-next/mongo-query-builder` package README](../../packages/2-mongo-family/5-query-builders/query-builder/README.md)
- [ADR 201 — State-machine pattern for typed DSL builders](../../docs/architecture%20docs/adrs/ADR%20201%20-%20State-machine%20pattern%20for%20typed%20DSL%20builders.md)
- [ADR 209 — Mongo result-shape as a structural plan field](../../docs/architecture%20docs/adrs/ADR%20209%20-%20Mongo%20result-shape%20as%20a%20structural%20plan%20field.md)
- [`PipelineChain.lookup` (current implementation)](../../packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts:269-304)
- [`builder.test-d.ts` (type tests to update)](../../packages/2-mongo-family/5-query-builders/query-builder/test/builder.test-d.ts)
- [`mongo-blog-leaderboard` example](../../examples/mongo-blog-leaderboard/)

# Open Questions

1. **Naming of the new `DocField` variant and its codec id.** The spec uses `ModelArrayField` and `'prisma/modelArray@1'` illustratively. The implementer picks the final names. The codec id is a type-level sentinel only — it does not need a runtime codec entry — so the naming convention should match how `'prisma/object@1'` is treated for `ObjectField`.
2. **Where the `col` accessor lives.** Either a new module in `@prisma-next/mongo-query-builder` (e.g. `collection-accessor.ts`) or alongside `field-accessor.ts`. Implementer's call; the spec doesn't pin it.
3. **Runtime guard for non-path expressions returned from `on`.** AC3 allows either compile-time rejection or a runtime throw. Compile-time is preferable if it can be done without making `on`'s return type painful to write; otherwise the runtime throw inside `lookup()`'s body is acceptable and matches the defensive style of `deconstructFindAndModifyChain` ([`builder.ts` L866](../../packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts:866)).
4. **Sample-file disposition.** [`sample.ts`](../../examples/mongo-blog-leaderboard/src/sample.ts) currently exists only as a demonstration of the typing gap. Once the gap is fixed, the file's purpose is unclear. Recommendation: convert it into a positive demo of the new shape (with `// @ts-expect-error`-annotated typo lines) or delete it and rely on the package's type tests. Implementer's call.
