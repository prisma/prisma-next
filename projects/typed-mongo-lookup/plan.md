# Typed Mongo `lookup` plan

## Summary

Re-shape `PipelineChain.lookup(...)` in `@prisma-next/mongo-query-builder` to use a callback-based selection pattern (matching `group()`) for its inputs and to thread the foreign collection's row type into the resulting `Shape`. Replaces an options-object signature whose `from` and `foreignField` silently accept bad strings, and whose `as` field resolves to `unknown[]`. Single milestone — there is no backward-compat shim, so the type-system change, the new runtime, the call-site updates, and the test updates must land together.

**Spec:** `projects/typed-mongo-lookup/spec.md`

## Collaborators

| Role         | Person/Team                          | Context                                                                |
| ------------ | ------------------------------------ | ---------------------------------------------------------------------- |
| Maker        | Project owner (this maker)           | Drives execution of the typed-lookup change.                           |
| Reviewer     | Mongo-family code-owner              | Reviews builder.ts changes against ADR 201 markers and DSL conventions.|

## Shipping Strategy

This project is a single milestone delivered as a single PR. The change is structurally atomic — `lookup()`'s public signature changes, all in-repo call sites are updated in the same commit set, and there is no backward-compat shim (per spec FR8). Production safety is maintained by the fact that there are no production consumers of `lookup()` outside this repo: the package is workspace-internal and the only call sites live under `examples/` and the package's own tests. The implicit "gate" between old and new behaviour is therefore the merge itself; before merge no consumer is affected, after merge every consumer is on the new shape.

## Test Design

Test cases below are derived from spec acceptance criteria AC1–AC8. All test cases land in milestone M1.

| AC    | TC     | Test Case                                                                                                                                                                 | Type           | Milestone | Expected Outcome                                                                                                                  |
|-------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------|
| AC-1  | TC-1   | `lookup((col) => ({ from: col.usexxxrs, ... }))` invoked against a typed contract with no `usexxxrs` root.                                                                | Type test (`expectTypeOf` / `@ts-expect-error`) | M1 | TypeScript error at `col.usexxxrs`.                                                                                               |
| AC-2  | TC-2   | `lookup((col) => ({ from: col.users, on: (l, f) => ({ local: l._idxx, foreign: f._id }), as: 'x' }))` against a contract whose pipeline shape has no `_idxx`.             | Type test      | M1        | TypeScript error at `l._idxx`.                                                                                                    |
| AC-2  | TC-3   | Same as TC-2 but typo on `foreign.<typo>`.                                                                                                                                | Type test      | M1        | TypeScript error at `f.<typo>`.                                                                                                   |
| AC-3  | TC-4   | `on` callback returns a non-leaf expression (e.g. an aggregation expression like `local._id.toUpper()` or a non-`LeafExpression` value) for either `local` or `foreign`.  | Type test or unit | M1     | Either compile-time rejection (preferred) or a thrown error from `lookup()` build with a clear message.                            |
| AC-4  | TC-5   | `mongoQuery<TC>(...).from('orders').lookup((col) => ({ from: col.users, on: (l, f) => ({ local: l.customerId, foreign: f._id }), as: 'customer' })).build()`.             | Positive type test | M1    | Resolved row's `customer` is `Array<UserRow>` with concrete leaf types (e.g. `_id: string; name: string; …`); not `unknown[]`.    |
| AC-5  | TC-6   | After `.lookup({ as: 'customer' })`, type tests: `findOneAndUpdate` is absent on the returned chain; no-arg `updateMany()` is absent; subsequent `.match(...)` is `'past-leading'`. | Type test | M1 | Markers cleared per ADR 201; no terminal-method appearance regressions.                                                           |
| AC-6  | TC-7   | Equivalent inputs through old vs new APIs construct equal `MongoLookupStage` content (compared structurally on `from` / `localField` / `foreignField` / `as`).            | Unit (vitest) in `builder.test.ts` | M1 | New API's stage equals the canonical `MongoLookupStage` produced by direct construction; runtime emission unchanged.              |
| AC-7  | TC-8   | `mongo-blog-leaderboard` test (`leaderboard.test.ts`) executes against `mongodb-memory-server` with `top.author` accessed without the `as Array<{ name: string }>` cast.  | Integration (vitest) | M1   | Test passes; `top.author` typed as `Array<UserRow>`; assertions on `author[0].name` compile and pass.                              |
| AC-8  | TC-9   | Workspace-wide `pnpm typecheck` after refactor.                                                                                                                           | Validation gate | M1       | All packages typecheck clean. No remaining call sites of the old options-object `lookup({...})` shape.                            |
| AC-8  | TC-10  | Workspace-wide grep for `\.lookup\(\s*\{` (old shape pattern) across `packages/`, `examples/`, `test/`.                                                                   | Validation gate | M1       | Zero matches outside of the new API's internal handling (e.g. test fixtures stating "old shape" intentionally).                    |
| —     | TC-11  | `pnpm lint:deps` after refactor.                                                                                                                                          | Validation gate | M1       | No new layering / import-validation violations.                                                                                   |
| —     | TC-12  | `pnpm build` (turbo) after refactor.                                                                                                                                      | Validation gate | M1       | All packages build; downstream `dist/*.d.mts` declarations refreshed for `@prisma-next/mongo-query-builder` (and `mongo-contract` if extended).|

## Milestones

### Milestone 1 (M1): Typed `lookup` end-to-end

Re-shape the `lookup()` API in `@prisma-next/mongo-query-builder`, extend the `DocField` vocabulary with a model-array variant, teach `ResolveRow` to dereference it, update every in-repo call site, and rewrite the type and runtime tests. Demonstrable by: `mongo-blog-leaderboard` test passes without the `as`-cast at `leaderboard.test.ts:51`; positive type test asserts `Array<UserRow>` for the resolved `as` field; negative type tests guard each input against typos.

**Tasks (sequenced):**

- [ ] **T1.** Add the new `DocField` variant carrying the foreign model name. Place the variant alongside `ObjectField` in `packages/2-mongo-family/5-query-builders/query-builder/src/resolve-path.ts` (or a new file if cleaner). Use a sentinel codec id (illustratively `'prisma/modelArray@1'`) — naming is the implementer's call per spec Open Question 1, but treat it as a type-level sentinel only, no runtime codec entry. *(satisfies setup for TC-5)*
- [ ] **T2.** Extend `ResolveRow` in `packages/2-mongo-family/5-query-builders/query-builder/src/types.ts` to detect the new variant *before* the codec lookup and resolve it to `ResolveRow<ModelToDocShape<TC, ForeignName>, CodecTypes>[]`. Thread the contract type parameter through `ResolveRow` as needed. *(satisfies TC-5)*
- [ ] **T3.** Define a `CollectionAccessor<TC>` type and a `createCollectionAccessor<TC>(contract)` runtime in the builder package (location is the implementer's call per spec Open Question 2). The accessor exposes one entry per `keyof TC['roots']`, returning a phantom-typed `CollectionRef<TC, RootName>` carrying the root literal in the type and the root-name string at runtime. *(satisfies setup for TC-1)*
- [ ] **T4.** Rewrite `PipelineChain.lookup` in `packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts` to accept a single callback `(col: CollectionAccessor<TC>) => Options`. Inside `Options`:
  - `from` is a `CollectionRef<TC, RootName>` (type carries the root literal).
  - `on` is a callback `(local: FieldAccessor<Shape, N>, foreign: FieldAccessor<ModelToDocShape<TC, RootName>, …>) => { local: LeafExpression<…>; foreign: LeafExpression<…> }`.
  - `as` stays a fresh `string` literal type parameter.
  Extract the `_root` off the `CollectionRef` and the `_path` off each leaf to construct the same `MongoLookupStage` today's code constructs. Preserve all marker effects (clear `UpdateEnabled`, clear `FindAndModifyEnabled`, set `'past-leading'`, preserve `N`). *(satisfies TC-1, TC-2, TC-3, TC-7)*
- [ ] **T5.** Decide AC3's resolution: either tighten `on`'s return so non-leaf expressions are a compile-time error, or accept a runtime guard inside `lookup()` that throws on non-leaf returns (matching the defensive style of `deconstructFindAndModifyChain`). Implement the chosen path. Record the decision in the implementer's report. *(satisfies TC-4)*
- [ ] **T6.** Update `packages/2-mongo-family/5-query-builders/query-builder/test/builder.test-d.ts`:
  - Replace the existing `lookup()` positive test at L79–L94 with the new shape.
  - Replace the existing result-shape test at L230–L249 — the `customer: unknown[]` expectation becomes `Array<UserRow>` with concrete leaf types (TC-5).
  - Add `// @ts-expect-error`-annotated negative tests covering TC-1, TC-2, TC-3, TC-4 (if compile-time is chosen for AC3).
  - Add a positive test for marker preservation (TC-6).
- [ ] **T7.** Update `packages/2-mongo-family/5-query-builders/query-builder/test/builder.test.ts` runtime tests to use the new call shape, and add the structural-equivalence test (TC-7) asserting that the `MongoLookupStage` produced by the new API matches a reference stage.
- [ ] **T8.** Update `examples/mongo-blog-leaderboard/src/queries.ts` (the production example) to the new call shape.
- [ ] **T9.** Update `examples/mongo-blog-leaderboard/test/leaderboard.test.ts`: remove the `as Array<{ name: string }>` cast at L51 and any other workarounds; rely on the now-precise typing (TC-8).
- [ ] **T10.** Resolve the disposition of `examples/mongo-blog-leaderboard/src/sample.ts` per spec Open Question 4. Default action: convert into a positive demo of the new shape with `// @ts-expect-error`-annotated typo lines, so it serves as a doubled-up demo of the type guards. Implementer may instead delete the file if the type tests in T6 cover the same ground; record the choice in the round report.
- [ ] **T11.** Update the `@prisma-next/mongo-query-builder` README (and any other docs containing the old `lookup({...})` shape) to the new callback shape. Run `rg -nF '.lookup({' packages/ examples/ docs/` afterwards to confirm zero stale snippets remain (TC-10).
- [ ] **T12.** Run the full validation gate. Fix any cross-package consumer breakage that surfaces (TC-9, TC-10, TC-11, TC-12). Per AGENTS.md, run `pnpm build` first (since exported types changed) before workspace-wide `pnpm typecheck`.
- [ ] **T13. Close-out.** Verify all acceptance criteria pass in the project's review artifacts. Migrate any long-lived design decisions captured during execution into the appropriate durable docs:
  - The new `DocField` variant's existence and semantics are a small extension to ADR 201's "marker table" framing or to the package README, not a new ADR. Update whichever is the natural home (likely the package README's section on result-shape encoding, with a one-line cross-reference from ADR 201 if appropriate).
  - Confirm no repo-wide references point at `projects/typed-mongo-lookup/**`.
  - Delete `projects/typed-mongo-lookup/`.
  Do **not** manually close any Linear issue — the GitHub integration handles that on PR merge if a Linear identifier is present in the branch/PR title.

**Validation gate:**

- `pnpm build` — required first, per AGENTS.md, since exported types in `@prisma-next/mongo-query-builder` change and downstream `examples/` consume them.
- `pnpm typecheck` — workspace-wide, since this milestone changes a public export shape.
- `pnpm test:packages` — covers `@prisma-next/mongo-query-builder` unit and type tests.
- `pnpm test:integration` — covers the `mongo-blog-leaderboard` example end-to-end via `mongodb-memory-server`.
- `pnpm lint:deps` — guards layering / import boundaries.
- `rg -nF '.lookup({' packages/ examples/ docs/` — must return zero matches outside intentional documentation of the old shape (and even those should be removed per T11).

## Open Items

Carried forward from `spec.md` § Open Questions:

1. **Naming of the new `DocField` variant and its codec id.** Implementer's call. Spec uses `ModelArrayField` / `'prisma/modelArray@1'` illustratively; final names should follow the convention set by `ObjectField` / `'prisma/object@1'`.
2. **Where the `col` accessor lives.** Implementer's call (new module vs. alongside `field-accessor.ts`).
3. **Compile-time vs. runtime guard for non-leaf `on` returns.** T5 records the chosen path. If compile-time, add the negative type test in T6; if runtime, add a unit test in T7 asserting the thrown error.
4. **`sample.ts` disposition.** T10 default is "convert to positive demo with `@ts-expect-error` typos"; implementer may delete instead.
