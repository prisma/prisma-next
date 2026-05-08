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

Test cases below are derived from spec acceptance criteria AC1–AC7 (post R1.5; original AC1 deferred to TML-2400). All test cases land in milestone M1.

| AC    | TC     | Test Case                                                                                                                                                                 | Type           | Milestone | Expected Outcome                                                                                                                  |
|-------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------|
| AC-1  | TC-1   | `lookup((from) => from('users').on((l, f) => ({ local: l._idxx, foreign: f._id })).as('x'))` against a contract whose pipeline shape has no `_idxx`.                      | Type test (`expectTypeOf` / `@ts-expect-error`) | M1 | TypeScript error at `l._idxx`.                                                                                                    |
| AC-1  | TC-2   | Same as TC-1 but typo on `foreign.<typo>`.                                                                                                                                | Type test      | M1        | TypeScript error at `f.<typo>`.                                                                                                   |
| AC-2  | TC-3   | `on` callback returns a non-leaf expression (e.g. an aggregation expression like `local._id.toUpper()` or a non-`LeafExpression` value) for either `local` or `foreign`.  | Type test or unit | M1     | Either compile-time rejection (preferred) or a thrown error from `lookup()` build with a clear message.                            |
| AC-3  | TC-4   | `mongoQuery<TC>(...).from('orders').lookup((from) => from('users').on((l, f) => ({ local: l.customerId, foreign: f._id })).as('customer')).build()`.                      | Positive type test | M1    | Resolved row's `customer` is `Array<UserRow>` with concrete leaf types (e.g. `_id: string; name: string; …`); not `unknown[]`.    |
| AC-4  | TC-5   | After `.lookup(...).as('customer')`, type tests: `findOneAndUpdate` is absent on the returned chain; no-arg `updateMany()` is absent; subsequent `.match(...)` is `'past-leading'`. | Type test | M1 | Markers cleared per ADR 201; no terminal-method appearance regressions.                                                           |
| AC-5  | TC-6   | Equivalent inputs through old vs new APIs construct equal `MongoLookupStage` content (compared structurally on `from` / `localField` / `foreignField` / `as`).            | Unit (vitest) in `builder.test.ts` | M1 | New API's stage equals the canonical `MongoLookupStage` produced by direct construction; runtime emission unchanged.              |
| AC-6  | TC-7   | `mongo-blog-leaderboard` test (`leaderboard.test.ts`) executes against `mongodb-memory-server` with `top.author` accessed without the `as Array<{ name: string }>` cast.  | Integration (vitest) | M1   | Test passes; `top.author` typed as `Array<UserRow>`; assertions on `author[0].name` compile and pass.                              |
| AC-7  | TC-8   | Workspace-wide `pnpm typecheck` after refactor.                                                                                                                           | Validation gate | M1       | All packages typecheck clean. No remaining call sites of the old options-object `lookup({...})` shape.                            |
| AC-7  | TC-9   | Workspace-wide grep for `\.lookup\(\s*\{` (old shape pattern) across `packages/`, `examples/`, `test/`.                                                                   | Validation gate | M1       | Zero matches outside of the new API's internal handling (e.g. test fixtures stating "old shape" intentionally).                    |
| —     | TC-10  | `pnpm lint:deps` after refactor.                                                                                                                                          | Validation gate | M1       | No new layering / import-validation violations.                                                                                   |
| —     | TC-11  | `pnpm build` (turbo) after refactor.                                                                                                                                      | Validation gate | M1       | All packages build; downstream `dist/*.d.mts` declarations refreshed for `@prisma-next/mongo-query-builder` (and `mongo-contract` if extended).|

**Deferred to [TML-2400](https://linear.app/prisma-company/issue/TML-2400/tighten-mongocontract-types-to-preserve-literal-generic-inference-root):** the original AC1 / TC-1 (`from('usexxxrs')` typo rejection). The R1.5 verification spike confirmed this is a pre-existing limitation of `Contract.roots: Record<string, string>` shared with today's `mongoQuery.from('badname')` baseline. The new `lookup()` surface inherits the baseline; the upstream fix is tracked separately.

## Milestones

### Milestone 1 (M1): Typed `lookup` end-to-end

Re-shape the `lookup()` API in `@prisma-next/mongo-query-builder`, extend the `DocField` vocabulary with a model-array variant, teach `ResolveRow` to dereference it, update every in-repo call site, and rewrite the type and runtime tests. Demonstrable by: `mongo-blog-leaderboard` test passes without the `as`-cast at `leaderboard.test.ts:51`; positive type test asserts `Array<UserRow>` for the resolved `as` field; negative type tests guard each input against typos.

**Tasks (sequenced):**

- [x] **T1.** Add the new `DocField` variant carrying the foreign model name. Place the variant alongside `ObjectField` in `packages/2-mongo-family/5-query-builders/query-builder/src/resolve-path.ts` (or a new file if cleaner). Use a sentinel codec id (illustratively `'prisma/modelArray@1'`) — naming is the implementer's call per spec Open Question 1, but treat it as a type-level sentinel only, no runtime codec entry. *(satisfies setup for TC-4) — completed in R1, uncommitted in working tree*
- [x] **T2.** Extend `ResolveRow` in `packages/2-mongo-family/5-query-builders/query-builder/src/types.ts` to detect the new variant *before* the codec lookup and resolve it to `ResolveRow<ModelToDocShape<TC, ForeignName>, CodecTypes>[]`. Thread the contract type parameter through `ResolveRow` as needed. *(satisfies TC-4) — completed in R1, uncommitted in working tree*
- [ ] **T3.** Define `LookupBuilder<TC, Shape, R, M>` and `LookupBuilderWithKey<TC, Shape, R, M, LeafL, LeafF>` types and runtime in the builder package (location is the implementer's call per spec Open Question 2; `lookup-builder.ts` recommended). Surface:
  - The outer callback receives `from: <R extends keyof TC['roots'] & string>(name: R) => LookupBuilder<TC, Shape, R, ModelOf<TC, R>>`.
  - `LookupBuilder.on(cb: (local: FieldAccessor<Shape, N>, foreign: FieldAccessor<ModelToDocShape<TC, M>, …>) => { local: LeafExpression<…>; foreign: LeafExpression<…> }) => LookupBuilderWithKey<…>`.
  - `LookupBuilderWithKey.as<As extends string>(name: As) => LookupResult<TC, Shape, R, M, LeafL, LeafF, As>` (a typed handle that `lookup()` consumes; can simply be the assembled options object internally).
  - At runtime: `from` captures the root-name string into a builder instance; `.on` runs the user callback with `(local, foreign)` accessors and captures the resulting paths; `.as` finalises with the user-chosen field name.
  *(satisfies setup for TC-1, TC-2, TC-3, TC-4)*
- [ ] **T4.** Rewrite `PipelineChain.lookup` in `packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts` to accept a single callback `(from: <R>(name: R) => LookupBuilder<TC, Shape, R, ModelOf<TC, R>>) => LookupResult<…>`. Extract the captured root, local-leaf, foreign-leaf, and `as` literal from the returned `LookupResult` to construct the same `MongoLookupStage` today's code constructs. Preserve all marker effects (clear `UpdateEnabled`, clear `FindAndModifyEnabled`, set `'past-leading'`, preserve `N`). The returned `PipelineChain`'s `Shape` gains `As: ModelArrayField<M>` (the new `DocField` variant from T1). *(satisfies TC-1, TC-2, TC-3, TC-4, TC-6)*
- [ ] **T5.** Decide AC2's resolution: either tighten `on`'s return so non-leaf expressions are a compile-time error, or accept a runtime guard inside `lookup()` that throws on non-leaf returns (matching the defensive style of `deconstructFindAndModifyChain`). Implement the chosen path. Record the decision in the implementer's report. *(satisfies TC-3)*
- [ ] **T6.** Update `packages/2-mongo-family/5-query-builders/query-builder/test/builder.test-d.ts`:
  - Replace the existing `lookup()` positive test at L79–L94 with the new chained shape.
  - Replace the existing result-shape test at L230–L249 — the `customer: unknown[]` expectation becomes `Array<UserRow>` with concrete leaf types (TC-4).
  - Add `// @ts-expect-error`-annotated negative tests covering TC-1, TC-2, TC-3 (if compile-time is chosen for AC2).
  - Add a positive test for marker preservation (TC-5).
  - Do **not** add a negative test for bad-`from(name)` typos — that's deferred to TML-2400; document the omission with a one-line comment pointing at the ticket.
- [ ] **T7.** Update `packages/2-mongo-family/5-query-builders/query-builder/test/builder.test.ts` runtime tests to use the new call shape, and add the structural-equivalence test (TC-6) asserting that the `MongoLookupStage` produced by the new API matches a reference stage.
- [ ] **T8.** Update `examples/mongo-blog-leaderboard/src/queries.ts` (the production example) to the new chained call shape.
- [ ] **T9.** Update `examples/mongo-blog-leaderboard/test/leaderboard.test.ts`: remove the `as Array<{ name: string }>` cast at L51 and any other workarounds; rely on the now-precise typing (TC-7).
- [ ] **T10.** Resolve the disposition of `examples/mongo-blog-leaderboard/src/sample.ts` per spec Open Question 4. Default action: convert into a positive demo of the new chained shape with `// @ts-expect-error`-annotated typo lines for `local.<typo>` and `foreign.<typo>` (the achievable gaps post-AC1-deferral), so it serves as a doubled-up demo of the type guards. Implementer may instead delete the file if the type tests in T6 cover the same ground; record the choice in the round report.
- [ ] **T11.** Update the `@prisma-next/mongo-query-builder` README (and any other docs containing the old `lookup({...})` shape) to the new chained callback shape. Run `rg -nF '.lookup({' packages/ examples/ docs/` afterwards to confirm zero stale snippets remain (TC-9).
- [ ] **T12.** Run the full validation gate. Fix any cross-package consumer breakage that surfaces (TC-8, TC-9, TC-10, TC-11). Per AGENTS.md, run `pnpm build` first (since exported types changed) before workspace-wide `pnpm typecheck`.
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
2. **Where the `LookupBuilder` types and `from` callable live.** Implementer's call (new module e.g. `lookup-builder.ts`, vs. alongside `field-accessor.ts`).
3. **Compile-time vs. runtime guard for non-leaf `on` returns.** T5 records the chosen path. If compile-time, add the negative type test in T6; if runtime, add a unit test in T7 asserting the thrown error.
4. **`sample.ts` disposition.** T10 default is "convert to positive demo with `@ts-expect-error` typos for `local`/`foreign`"; implementer may delete instead.

## Replan history

- **R1.5 (2026-05-08).** API shape replanned from a single object-return callback `(col) => ({ from, on, as })` to the chained form `(from) => from(name).on(cb).as(name)`. Driver: a 30+-repro verification spike confirmed the original shape widened the foreign-root literal to `string` under TS 5.9's inference of generic-return-into-contravariant-callback-parameter triangles. The chained form grounds the literal sequentially before the inner callback is typed; verified to pass AC2-local, AC2-foreign, AC3, and the marker checks. AC1 (bad-root rejection) was simultaneously deferred to [TML-2400](https://linear.app/prisma-company/issue/TML-2400/tighten-mongocontract-types-to-preserve-literal-generic-inference-root) because the spike confirmed it as a pre-existing limitation of the foundational `Contract.roots: Record<string, string>` type, identical to today's `mongoQuery.from('badname')` behavior. T1 + T2 (`ModelArrayField` + `ResolveRow` extension) survived the replan unchanged and were marked complete in-place. T3+ rewritten to target the chained shape.
