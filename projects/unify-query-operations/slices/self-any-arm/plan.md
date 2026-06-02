# Slice plan: self-any-arm

**Spec.** [`./spec.md`](./spec.md).
**Parent project.** [`projects/unify-query-operations/`](../../).
**Linear.** TML-2354 (project-level; no per-slice sub-issue; the PR title prefix is `tml-2354:`).
**Branch.** `unify-op-registries` (the project working branch).
**PR-cap.** One PR for both dispatches combined.

## Decomposition rationale

Two dispatches. The natural joint is the package boundary: D1 lands the **registry-primitive layer** (the type extension + the validator + its tests, across `@prisma-next/operations` and the paired `@prisma-next/sql-contract` type); D2 lands the **ORM consumer layer** (the only runtime branch and the only type-level matcher that switch on the discriminant, both in `@prisma-next/sql-orm-client`, plus an integration test that exercises end-to-end wiring of `self: { any: true }` through a synthetic operation).

This joint produces a clean stable state at the dispatch boundary: after D1, the registry primitive accepts the new arm and the contract type carries it, but no consumer is forced to handle it yet (the existing one branch silently ignores any op registered with `any: true` — and the slice registers none, so the broken-intermediate-state risk is zero). After D2, the only consumer handles all three arms and is exercised by an integration test.

A single combined dispatch would total ~80 LoC across 5 source files + 2 test files — pushing into M+ territory by file-count and multi-discipline (type extension + validator + runtime + type-level matcher + tests in two unrelated packages). Splitting into M + S keeps each dispatch comfortably under its size bucket and lets the orchestrator WIP-inspect both layers independently.

## Dispatches

### Dispatch 1: Registry-primitive layer — `any: true` arm + validator + tests

**Intent.** Add the `{ readonly any: true }` arm to `SelfSpec` (`@prisma-next/operations`) and the parallel `QueryOperationSelfSpec` (`@prisma-next/sql-contract`). Extend `createOperationRegistry`'s registration validator at `packages/1-framework/1-core/operations/src/index.ts:42-50` so exactly one of `codecId`, `traits`, `any` must be set when `self` is present. Update the existing two validator-test expected error messages to match the reworded messages, and add three new test cases: positive `{ any: true }` accepted, ambiguous `{ any: true, codecId: ... }` rejected, ambiguous `{ any: true, traits: [...] }` rejected. **What stays the same.** No new operation registers with the new arm; no `OpMatchesField` change; no `model-accessor.ts` change; no runtime behaviour change for any existing operation (this slice's existing-operations regression bar is "`pnpm test:packages` for sql-orm-client and operations is byte-identical except for the validator error-message strings").

**Files in play.**

- `packages/1-framework/1-core/operations/src/index.ts` — extend `SelfSpec` (lines 12-14) and the validator (lines 42-50).
- `packages/1-framework/1-core/operations/test/operations-registry.test.ts` — update existing tests' expected messages (lines 51-84) and add three new validator tests; mirror the existing `// @ts-expect-error` pattern for negative cases.
- `packages/2-sql/1-core/contract/src/types.ts` — extend `QueryOperationSelfSpec` (lines 99-101) with the matching arm. Add a one-line comment cross-referencing `SelfSpec` so a future maintainer doesn't drift them.

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/operations build` clean.
- [ ] `pnpm --filter @prisma-next/sql-contract build` clean (re-emits `dist/*.d.mts` carrying the new arm).
- [ ] `pnpm typecheck` clean workspace-wide. Required because `@prisma-next/sql-orm-client`'s `OpMatchesField` consumes `QueryOperationSelfSpec` structurally; the new arm widens the type and TypeScript must still accept the existing pattern-match (the matcher continues to reach `false` for any `Self` it doesn't recognise — D2 fixes that).
- [ ] `pnpm --filter @prisma-next/operations test` green. Three new validator tests cover the positive + two ambiguous-combination negatives. Existing tests at lines 51-84 still pass with updated expected-message strings.
- [ ] `pnpm lint:deps` clean (no new package imports introduced).
- [ ] Grep gate: `rg 'any\??:\s*boolean' packages/1-framework/1-core/operations/src/` returns zero hits — confirms F2 avoidance (the new field is `any: true`, not `any?: boolean`).
- [ ] Intent-validation: diff is confined to the three named files. No edit to `model-accessor.ts`, no edit to `sql-orm-client/src/types.ts`, no edit to any operation that registers with `self`. If the implementer drifts toward D2's surface, the WIP inspection catches it.
- [ ] Edge cases from slice spec covered by this dispatch: "Registered with only `any: true`" (positive validator test), "any + codecId combination" (negative test), "any + traits combination" (negative test), "`self: {}` empty" (existing test updated), "`self: { traits: [] }` empty array" (existing test unchanged), "naming choice" (the arm is named `any`), "validator error message wording" (three distinct messages, all matching the existing tone).
- [ ] Destructive git operations forbidden without orchestrator approval (per F5 standard list: `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `git rm -r --force`, `rm -rf` against the worktree).

**Size.** M. Three files; ~50 LoC; one design judgment (validator error message structure); blast radius confined to two framework-core packages whose downstream typecheck D1 itself validates.

**Model tier.** Opus (orchestrator tier). The dispatch carries design judgment (error-message wording, decision to keep the two type defs in lock-step with a cross-reference comment) and touches framework-core surfaces; per [`model-tier.md`](../../../../drive/calibration/model-tier.md), substrate-change / design-judgment work routes to Opus.

**DoR confirmed:** ✓ Spec exists; intent stated; files-in-play named; "done when" binary; size M; failure modes F2 (avoid optional `any?:`) and F5 (destructive git) named; edge cases mapped; affected packages identified; downstream `@prisma-next/sql-orm-client` typecheck named because D1 modifies `packages/1-framework-core` / `packages/2-sql/1-core` surfaces; no fixture regen (no IR/emitter/serialiser change).

### Dispatch 2: ORM consumer layer — model-accessor branch + `OpMatchesField` clause + integration test

**Intent.** Extend the ORM model accessor's `self` resolution loop at `packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-85` with a third branch: when `self.any === true`, index the op under every codec known to `context.codecDescriptors`. Extend the type-level matcher `OpMatchesField` at `packages/3-extensions/sql-orm-client/src/types.ts:234-248` with an `any`-first clause that returns `true` for any field codec when `Self extends { readonly any: true }`. Add an integration test in `packages/3-extensions/sql-orm-client/test/model-accessor.test.ts` that synthesizes a `self: { any: true }` operation via a test-local registry and asserts the op appears as a method on every column of the test fixture, irrespective of the column's codec traits. **What stays the same.** No new operation in production code uses the new arm; the `COMPARISON_METHODS_META` loop, the extension-method factory, the relation accessor, and every other call site in `model-accessor.ts` are untouched. No change to `@prisma-next/operations`, `@prisma-next/sql-contract`, or the validator.

**Files in play.**

- `packages/3-extensions/sql-orm-client/src/model-accessor.ts` — add the third branch in the loop at lines 71-85; ~5 lines.
- `packages/3-extensions/sql-orm-client/src/types.ts` — add the `any`-first clause to `OpMatchesField` at lines 234-248; ~4 lines.
- `packages/3-extensions/sql-orm-client/test/model-accessor.test.ts` — add one `describe`/`it` block (or extend an existing one) registering a synthetic op with `self: { any: true }` and asserting it appears on every column accessor in the existing fixture; use the file's existing helpers (`getTestContext`, `createModelAccessor`, the `makeDescriptors` helper at line ~45 if mixed codec descriptors are needed).

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/sql-orm-client build` clean.
- [ ] `pnpm typecheck` clean workspace-wide.
- [ ] `pnpm --filter @prisma-next/sql-orm-client test` green. Includes the new integration test exercising `self: { any: true }` end-to-end (registration → runtime indexing → column-method surface).
- [ ] `pnpm lint:deps` clean.
- [ ] Intent-validation: diff is confined to the three named files. No edit to `@prisma-next/operations`, `@prisma-next/sql-contract`, or any other consumer. If the implementer drifts (e.g. starts registering `isNull` / `isNotNull` with the new arm — that is slice 2's work), the WIP inspection catches it.
- [ ] Edge cases from slice spec covered by this dispatch: "Runtime branch indexes under every codec" (covered by the new integration test asserting the synthetic op appears on every column), "type-level matcher returns `true` for any field codec" (the integration test's column-method surface is type-asserted by the existing `OpMatchesField`-driven `FieldOperations` type — TypeScript surfaces a regression as a typecheck failure on the assertion), "`OpMatchesField` ordering: `any` first" (a one-line comment in the new clause documents the intent so a later maintainer doesn't reorder it).
- [ ] Discovery via grep, not test suite (F3 avoidance): `rg 'self\.codecId\|self\.traits' packages/` returned exactly one consumer site (`model-accessor.ts:71-85`) at slice-spec time. Re-run before merge; if a new consumer site has appeared, halt and route to `drive-discussion`.
- [ ] Destructive git operations forbidden without orchestrator approval (F5 standard list).

**Size.** S. Two production files (~10 LoC total) + one integration test (~20 LoC). Confined to one package. Mechanical given the spec's pre-research; D1's typecheck cascade has already verified the structural extension.

**Model tier.** Sonnet (mid tier). Mechanical extension of a pre-researched consumer site; no new design decisions; the structural shape was settled in D1 and the spec.

**DoR confirmed:** ✓ Spec exists; intent stated; files-in-play named; "done when" binary; size S; failure modes F3 (consumer discovery already done — re-grep before merge) and F5 (destructive git) named; edge cases mapped; affected package identified; downstream `pnpm typecheck` is workspace-wide which catches any consumer of `@prisma-next/sql-orm-client`'s exported types; no fixture regen.

## Dependencies between dispatches

D2 depends on D1. The dependency is structural: D2's `OpMatchesField` clause matches on `Self extends { readonly any: true }`, which requires `QueryOperationSelfSpec` to carry the `{ any: true }` arm (otherwise the conditional clause is dead code). Sequential delivery, no parallelisation.

## Cross-references

### Failure modes threaded

- [F2 — Constructor magic for optional fields](../../../../drive/calibration/failure-modes.md#f2-constructor-magic-for-optional-fields). The new field is **required** `any: true`, not optional `any?: boolean`. Threaded into D1's grep gate (`rg 'any\??:\s*boolean'`).
- [F3 — Discovery via test suite instead of grep](../../../../drive/calibration/failure-modes.md#f3-discovery-via-test-suite-instead-of-grep). Consumer discovery already complete at slice-spec time (one runtime consumer, one type-level consumer). Threaded into D2's "done when" as a re-grep before merge.
- [F5 — Destructive git operations](../../../../drive/calibration/failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval). Standard non-negotiable disposition in both dispatches.

### Grep library entries

- `rg 'any\??:\s*boolean'` — D1 gate to confirm F2 avoidance (the field is property-literal-typed, not boolean).
- `rg 'self\.codecId\|self\.traits' packages/` — D2 gate to confirm the consumer count is unchanged from the slice-spec snapshot (one runtime site, in `model-accessor.ts`).
- `rg 'QueryOperationSelfSpec' packages/` — sanity grep both dispatches can run; the slice-spec snapshot was 4 hits (type def, re-export, type-level consumer in `OpMatchesField`'s neighbourhood via the import chain, and a cipherstash doc-comment).

## Slice-DoD reachability

Every condition in the slice-DoD is covered by one or both dispatches:

| Slice-DoD condition | Covered by |
|---|---|
| **SDoD1.** `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps` + intent-validation. | D1 "done when" + D2 "done when" (typecheck workspace-wide is in both). |
| **SDoD2.** Every pre-named edge case handled per its disposition. | Slice-spec edge cases mapped per-dispatch in each "Edge cases covered" sub-list. |
| **SDoD3.** Reviewer verdict accept on `projects/unify-query-operations/reviews/code-review.md`. | End-of-slice; the dispatch loop terminates when the reviewer reports SATISFIED. |
| **SDoD4.** Manual-QA N/A (no user-observable change). | Already declared in the spec; neither dispatch introduces user-observable surface. |
| **SDoD5.** Slice doesn't touch out-of-scope surfaces. | Intent-validation gate in both dispatches; D1 explicitly forbids touching `model-accessor.ts` or `sql-orm-client/src/types.ts`; D2 explicitly forbids touching `@prisma-next/operations` or `@prisma-next/sql-contract`. |
| **SDoD6.** `QueryOperationSelfSpec` and `SelfSpec` carry semantically identical arms in the same order; cross-reference comment present. | D1 (both type defs modified together; cross-reference comment added). |
| **SDoD7.** `OpMatchesField` returns `true` for the `any: true` arm against any field codec; no regression for existing arms. | D2's integration test + workspace typecheck. |

## Risks

1. **F2 backslide via `any: boolean`.** If the implementer drafts `any?: boolean` instead of `any: true`, the validator's "exactly one set" check becomes ambiguous (is `any: false` "unset"?) and TypeScript can no longer distinguish a deliberately-set `false` from an omitted field. Mitigated by D1's grep gate and the explicit spec language ("required `any: true`, not optional"). If the gate hits, halt D1 and re-implement.
2. **Lock-step drift between `SelfSpec` and `QueryOperationSelfSpec`.** The two type defs live in different packages and one is publicly exported. If only one is extended, downstream consumers (or future contributors authoring contract-level operations) can ship a runtime registration that the contract type can't represent. Mitigated by D1 modifying both together and adding a cross-reference comment (SDoD6).
3. **`OpMatchesField` ordering reorder by a later refactor.** The `any`-first clause is correct in any order (the discriminated union guarantees mutual exclusion), but reading it first matches documentation intent. A later maintainer who reorders for "consistency with the runtime branch" risks confusing the next reader. Mitigated by a one-line comment in D2's clause.
