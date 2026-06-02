# Slice plan: collapse-consumers

**Spec.** [`./spec.md`](./spec.md).
**Parent project.** [`projects/unify-query-operations/`](../../).
**Linear.** TML-2354. Per the amended delivery model (single PR at project close), this slice does NOT open its own PR; commits land on `unify-op-registries`.
**Branch.** `unify-op-registries`.
**Base commit (head before slice 3 starts):** `0b3259192` (project plan amendment recording the 3 → 3 + 3b split).

## Decomposition rationale

Three dispatches. The dependency analysis surfaced a non-obvious sequencing constraint that drove the final shape:

**Sequencing constraint.** The slice spec lists three logical workstreams (sql-builder cleanup, ORM accessor collapse, consumer migration + manual-QA). The naive ordering would be "workstream order = dispatch order." But the `fns.ne → fns.neq` rename in workstream 3 must happen BEFORE workstream 1 lands — the moment `BuiltinFunctions['ne']` is deleted, every existing `fns.ne(...)` callsite stops typechecking. The fix: pull the rename INTO workstream 1's dispatch (the sql-builder cleanup dispatch). The rename is small (11 sites across 5 files) and lives in the same conceptual scope (it's the consumer-side migration of `fns.ne` users to the new family-sourced `fns.neq`).

The doc-comment updates split across two natural homes: the family-sql comments at `core/query-operations.ts:15+127` are *sql-builder-deletion-driven* (they reference `BuiltinFunctions` as the lowering-parity source); the cipherstash comments at `execution/operators.ts:39` + `test/equality-trait-removal.test.ts` are *COMPARISON_METHODS_META-deletion-driven*. Each goes into the dispatch that drives the deletion.

**Final shape:**

- **D1 (M)** — full sql-builder workstream: rename `fns.ne → fns.neq`; delete `BuiltinFunctions<CT>` + `createBuiltinFunctions`; modify `Functions<QC>` type; simplify `createFunctions` Proxy; add cipherstash AC3 typecheck test; update family-sql lowering-parity comments.
- **D2 (M)** — full ORM workstream: collapse the two-loop synthesis (`createScalarFieldAccessor` + `createExtensionMethodFactory`); preserve `asc`/`desc` in `LEGACY_ORDERING_METHODS`; delete `COMPARISON_METHODS_META` + `ComparisonMethodFns` + `MethodFactory` + `ComparisonMethodMeta` + `scalarComparisonMethod` + `listComparisonMethod`; update cipherstash doc-comments.
- **D3 (S)** — manual-QA only: author `manual-qa.md` per `drive-qa-plan`; run it per `drive-qa-run`; record findings.

**Why D3 is its own dispatch rather than tail-end of D2.** Manual-QA is a distinct discipline from implementation — it requires a different stance (run the system, watch a real user surface), produces a different artifact (markdown script + run report), and its findings can prompt new work (re-open a dispatch if a 🛑 Blocker surfaces). Bundling it with D2 risks the implementer treating it as a tick-the-box step rather than a deliberate end-to-end verification of the user-visible cipherstash tightening.

## Dispatches

### Dispatch 1: sql-builder cleanup — rename, delete, simplify, verify AC3

**Intent.** Ship the entire sql-builder side of slice 3 in one dispatch. (1) Rename `fns.ne` to `fns.neq` across the 11 sites in 5 files identified in the slice spec. (2) Delete `BuiltinFunctions<CT>` from `packages/2-sql/4-lanes/sql-builder/src/expression.ts:62-117` and drop the `BuiltinFunctions<CT> &` intersection from `Functions<QC>` so the type derives purely from `DeriveExtFunctions<QC['queryOperationTypes']>` (which carries the 15 family ops via slice 2). (3) Delete `createBuiltinFunctions` from `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts:137-161` and simplify `createFunctions` Proxy at lines 180-195 to a single registry lookup. (4) Add a new type-d test asserting the cipherstash AC3 trait-tightening (`fns.eq(cipherstashCol, cipherstashCol)` fails type-check; `fns.eq(intCol, intCol)` typechecks). (5) Update the family-sql lowering-parity comments at `packages/2-sql/9-family/src/core/query-operations.ts:15+127` that reference the now-deleted surfaces. **What stays the same.** No edits to ORM model accessor, `COMPARISON_METHODS_META`, `HavingComparisonMethods<T>`, `ComparisonMethods<T, Traits>`, or anything under `packages/3-extensions/sql-orm-client/src/`. Workspace tests pass byte-identical SQL output (the family's `eq`/`neq`/etc. produce the same AST as `BuiltinFunctions['eq']` did — slice 2 D2 verified this with the 15-row lowering parity table).

**Files in play.**

- `packages/2-sql/4-lanes/sql-builder/src/expression.ts` — MODIFIED. Delete `BuiltinFunctions<CT>` lines 62-117; drop intersection from `Functions<QC>`.
- `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts` — MODIFIED. Delete `createBuiltinFunctions` lines 137-161; delete the private helpers it owns (`eq`, `ne`, `comparison`, `inOrNotIn`, `binaryWithSharedCodec`, `resolveOperand`, `toLiteralExpr`, `boolExpr`); simplify `createFunctions` Proxy to single registry lookup.
- `packages/2-sql/4-lanes/sql-builder/test/runtime/functions.test.ts` — MODIFIED. Rename 2 `fns.ne` → `fns.neq`.
- `packages/2-sql/4-lanes/sql-builder/test/cipherstash-trait-tightening.test-d.ts` — NEW (or extension of existing .test-d.ts per spec OQ3). ~30 LoC. Negative test for cipherstash + positive test for codecs with `equality` trait.
- `test/integration/test/sql-builder/subquery.test.ts` — MODIFIED. Rename 1 `fns.ne`.
- `test/integration/test/sql-builder/where.test.ts` — MODIFIED. Rename 1 `fns.ne`.
- `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts` — MODIFIED. Rename 4 `fns.ne`.
- `examples/prisma-next-demo/src/queries/cross-author-similarity.ts` — MODIFIED. Rename 3 `fns.ne`.
- `packages/2-sql/9-family/src/core/query-operations.ts` — MODIFIED. Update lowering-parity doc-comments at lines 15 + 127. Comment-only change; describe the family factory as source-of-truth (not parity destination).

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/sql-builder build` — clean.
- [ ] `pnpm --filter @prisma-next/sql-builder typecheck` — clean. The new type-d test must compile cleanly with the `@ts-expect-error` on the cipherstash negative case.
- [ ] `pnpm --filter @prisma-next/sql-builder test` — green.
- [ ] 8-package expanded targeted typecheck: `pnpm --filter @prisma-next/operations --filter @prisma-next/sql-contract --filter @prisma-next/sql-orm-client --filter @prisma-next/extension-cipherstash --filter @prisma-next/extension-pgvector --filter @prisma-next/family-sql --filter @prisma-next/sql-runtime --filter @prisma-next/sql-builder typecheck` — clean.
- [ ] `pnpm --filter @prisma-next/sql-orm-client test` — green. The ORM tests use `column.neq` (which never changed); they should pass without modification.
- [ ] Workspace regression test on the relevant package set (sql-builder + sql-orm-client + extension-postgres + extension-sqlite + extension-cipherstash + extension-pgvector + sql-runtime) — green.
- [ ] Demo run: `pnpm demo` (or whatever the project's demo command is) produces byte-identical output to a pre-slice-3 baseline. (The 3 renamed `fns.ne` → `fns.neq` in the demo are semantically identical; the SQL output must match.)
- [ ] `pnpm lint:deps` — clean.
- [ ] **F1 verification grep**: `rg 'BuiltinFunctions|createBuiltinFunctions' packages/ examples/ test/` returns ZERO production hits (test files may carry historical references in their own setup; if any remain, document why). Comment references at `packages/2-sql/9-family/src/core/query-operations.ts:15+127` should be UPDATED, not deleted (per § Files in play).
- [ ] **F3 verification grep**: `rg 'fns\.ne\(' packages/ examples/ test/` returns ZERO hits. (Sanity check: 11 sites renamed.)
- [ ] **NFR2 typecheck-time check**: measure `pnpm typecheck` wall-clock on the demo BEFORE the dispatch (you may need to `git stash` your diff to baseline) and AFTER. Report both numbers. If after > before by more than ~10%, surface to orchestrator with the delta.
- [ ] Intent-validation: `git diff --name-only HEAD` shows only the 9 files in scope. No edits to `model-accessor.ts`, `COMPARISON_METHODS_META`, `HavingComparisonMethods<T>`, or D2's territory.
- [ ] No-transient-IDs grep.
- [ ] Edge cases from slice spec covered by this dispatch: "fns.ne → fns.neq rename" (handled exhaustively); "Cipherstash fns.eq(cipherstashCol, ...) typecheck failure" (new test-d.ts); "Functions<QC> typecheck-time (NFR2)" (measured + reported).

**Size.** M. 9 files; ~140 LoC removed + ~30 LoC new test + 11 mechanical renames; one design judgment (test-d.ts placement + cipherstash trait-tightening assertion shape); cross-package blast radius (sql-builder is consumed everywhere) but the workspace tests + lint:deps + targeted typecheck jointly verify.

**Model tier.** Sonnet (mid tier). The deletions are mechanical; the type-d test follows ADR 203's `// @ts-expect-error` pattern (cipherstash already has precedent at `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts`). The judgment-heavy work (preserving lowering parity) was already done in slice 2 D2.

**DoR confirmed.** ✓ Spec exists; slice 2 closed (registry has `neq` ready to source); intent stated; files-in-play exhaustively named (9 files with site counts); "done when" binary with explicit grep gates; size M; failure modes F1/F3/F5 named; edge cases mapped; NFR2 mitigation specified; downstream packages enumerated.

### Dispatch 2: ORM accessor collapse — single registry loop, `LEGACY_ORDERING_METHODS`, delete `COMPARISON_METHODS_META`

**Intent.** Ship the entire ORM-side cleanup. (1) Collapse the two-loop synthesis in `createScalarFieldAccessor` (`packages/3-extensions/sql-orm-client/src/model-accessor.ts:138-167`) to a single registry-driven loop, supplemented by a transient `LEGACY_ORDERING_METHODS` map for `asc`/`desc`. (2) Collapse the second `COMPARISON_METHODS_META` loop inside `createExtensionMethodFactory` (lines 191-196) — rewire to read from the registry filtered by the result codec's traits, preserving the chained-comparison surface. (3) Delete `COMPARISON_METHODS_META` (lines 309-365) along with `ComparisonMethodFns`, `ComparisonMethodMeta`, `MethodFactory`, `scalarComparisonMethod`, `listComparisonMethod` (lines 278-301). PRESERVE `ComparisonMethods<T, Traits>` (FR13; trait-filter logic re-sources from the registry) and `HavingComparisonMethods<T>` (slice 4's territory). (4) Update cipherstash doc-comments: `packages/3-extensions/cipherstash/src/execution/operators.ts:39` references `COMPARISON_METHODS_META.eq` — update to reference the family's `eq` instead; `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts` has a doc-comment referencing `COMPARISON_METHODS_META` — update. **What stays the same.** No edits to sql-builder, family-sql, `HavingComparisonMethods<T>`, `ComparisonMethods<T, Traits>` (preserved per FR13). No introduction of `OrderByModelAccessor` or new ORM ordering registry (slice 3b). The per-column ORM method surface is byte-identical for codecs declaring traits (AC4); the only change is structural (registry-sourced not META-sourced).

**Files in play.**

- `packages/3-extensions/sql-orm-client/src/model-accessor.ts` — MODIFIED. Two-loop collapse in `createScalarFieldAccessor` + `createExtensionMethodFactory`. Add `LEGACY_ORDERING_METHODS` map (≤ 10 LoC).
- `packages/3-extensions/sql-orm-client/src/types.ts` — MODIFIED. Delete `COMPARISON_METHODS_META` (309-365), `ComparisonMethodFns` and related types (278-301). Preserve `ComparisonMethods<T, Traits>` (~line 470) and `HavingComparisonMethods<T>` (~line 514). Re-source `ComparisonMethods<T, Traits>`'s trait-filter logic from the registry (likely via the existing `FieldOperations` derivation).
- `packages/3-extensions/cipherstash/src/execution/operators.ts` — MODIFIED. Doc-comment-only update at line 39.
- `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts` — MODIFIED. Doc-comment-only update.

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/sql-orm-client build` — clean.
- [ ] `pnpm --filter @prisma-next/sql-orm-client typecheck` — clean.
- [ ] `pnpm --filter @prisma-next/sql-orm-client test` — green. **Particularly important**: the existing query-build integration tests (predicates, ordering, null checks, `in` with lists and subqueries) pass with NO modification. Same test count, same assertions. The implementer cites the pass count.
- [ ] 8-package expanded targeted typecheck — clean.
- [ ] Workspace regression test (sql-builder + sql-orm-client + postgres + sqlite + cipherstash + pgvector + sql-runtime) — green.
- [ ] `pnpm lint:deps` — clean.
- [ ] **F1 verification grep (load-bearing)**: `rg 'COMPARISON_METHODS|ComparisonMethodFns|ComparisonMethodMeta|MethodFactory|scalarComparisonMethod|listComparisonMethod' packages/3-extensions/sql-orm-client/src/` returns ZERO hits **except** the preserved `LEGACY_ORDERING_METHODS` name (which does not match `COMPARISON_METHODS` since it's `LEGACY_ORDERING_METHODS`) and `ComparisonMethods<T, Traits>` (which DOES match `ComparisonMethod` — verify the grep is precise enough to allow this single permitted hit). If new names appear (the F1 anti-pattern: rebranding `COMPARISON_METHODS_META` under a different name), surface to orchestrator.
- [ ] **SDoD10 verification grep**: `rg 'LEGACY_ORDERING_METHODS' packages/` returns hits in EXACTLY one file (the ORM model accessor). If it appears in multiple files, surface as scope creep.
- [ ] **AC4 surface-unchanged check**: for at least one column of each test contract codec (pg/int4, pg/text, cipherstash, arktype-json, pg/vector-like), grep or inspect the accessor's method set before and after. The method set must be identical (modulo deliberate AC3 — cipherstash never had `eq`/`neq` here so no change). The implementer reports per-codec method counts.
- [ ] Intent-validation: `git diff --name-only HEAD` shows only the 4 files in scope. No edits to sql-builder, family-sql, `HavingComparisonMethods<T>`, or `ComparisonMethods<T, Traits>`'s exported surface.
- [ ] No-transient-IDs grep.
- [ ] Edge cases from slice spec covered by this dispatch: "asc/desc preservation via LEGACY_ORDERING_METHODS"; "ORM column accessor surface unchanged (AC4)"; "createExtensionMethodFactory non-predicate result-method synthesis collapse"; "Transient .asc/.desc leak on WHERE accessor" (documented via the LEGACY_ORDERING_METHODS comment); "HavingComparisonMethods<T> stays in place"; "ComparisonMethods<T, Traits> preserved"; "Extensions referencing deleted symbols" (doc-comment updates).

**Size.** M. 4 files; ~120 LoC removed + ~15 LoC added (`LEGACY_ORDERING_METHODS` + comment + minor type changes) + ~25 LoC of synthesis-loop refactoring = ~160 LoC; one design judgment (the registry-driven re-implementation of `ComparisonMethods<T, Traits>`'s trait-filter); blast radius confined to sql-orm-client + cipherstash doc-comments. The largest dispatch in the slice but still within M.

**Model tier.** Opus (orchestrator tier). The judgment-heavy work — preserving trait-filter logic while collapsing the two-loop synthesis, handling the non-predicate result-method factory rewire, ensuring `ComparisonMethods<T, Traits>` derivation reads from the registry without changing its published surface — requires careful reasoning. A wrong cut here breaks the AC4 promise silently.

**DoR confirmed.** ✓ Depends on D1 closed (sql-builder cleanup must have landed so the workspace regression test's baseline is post-rename; otherwise the existing tests would already fail). Intent stated; files exhaustively named; "done when" binary with grep gates (including the load-bearing F1 grep); size M; failure modes F1/F3/F5 named; edge cases mapped; AC4 surface-unchanged check has a concrete verification protocol.

### Dispatch 3: Manual-QA — author + run + record

**Intent.** This is the slice-closing dispatch — code is fully landed after D2; D3's value-add is the **manual-QA discipline** the slice triggers because of the user-visible cipherstash trait tightening. Two atomic-skill invocations:

1. **`drive-qa-plan`** — author `projects/unify-query-operations/slices/collapse-consumers/manual-qa.md`. Script targets the **extension-author audience** primarily (cipherstash tightening affects them); single-audience declaration. Coverage probes per slice-spec SDoD4: (a) verify `fns.eq(cipherstashCol, cipherstashCol)` produces a typecheck error with a useful diagnostic message; (b) verify `fns.eq(intCol, intCol)` still typechecks; (c) verify the demo's renamed `fns.neq` calls produce byte-identical SQL output to the pre-rename baseline; (d) verify `m.field.asc()` still works through `LEGACY_ORDERING_METHODS` (regression check on the transient preservation).

2. **`drive-qa-run`** — execute the script end-to-end; record findings in `projects/unify-query-operations/slices/collapse-consumers/manual-qa-run-<date>.md`. No 🛑 Blocker findings allowed for SDoD4 PASS; ⚠️ Should-fix findings get triaged by orchestrator (either fix in a follow-up dispatch within slice 3 or file as out-of-scope).

**What stays the same.** No code changes in D3; this is documentation + observation only.

**Files in play.**

- `projects/unify-query-operations/slices/collapse-consumers/manual-qa.md` — NEW. ~30-50 LoC markdown.
- `projects/unify-query-operations/slices/collapse-consumers/manual-qa-run-<YYYY-MM-DD>.md` — NEW. ~20-40 LoC markdown run report.

**"Done when" gates.**

- [ ] `manual-qa.md` exists at the named path, follows the `drive-qa-plan` template, names the extension-author audience explicitly, covers all 4 probes from the slice spec.
- [ ] `manual-qa-run-<date>.md` exists at the named path, follows the `drive-qa-run` template, records the outcome of each of the 4 probes.
- [ ] No 🛑 Blocker findings.
- [ ] Each ⚠️ Should-fix finding (if any) is surfaced to the orchestrator with a recommended disposition.
- [ ] Edge cases from slice spec covered by this dispatch: "Manual-QA script REQUIRED — cipherstash trait tightening is user-visible" (this dispatch IS the manual-QA); "Demo migration risk" (probe (c) verifies demo SQL output unchanged).

**Size.** S. Two markdown files; ~50-90 LoC total; no code; one design judgment (script structure per `drive-qa-plan`).

**Model tier.** Sonnet (mid tier). The `drive-qa-plan` skill provides the template structure; the `drive-qa-run` skill provides the execution protocol. The judgment is in probe design (4 probes well-targeted at user-visible surface) and observation quality.

**DoR confirmed.** ✓ Depends on D2 closed (full code lands; the manual-QA exercises real behaviour). Intent clear; files-in-play named (two markdown files); "done when" gates binary; size S; failure modes — F5 (no destructive git during QA — the script doesn't touch git; the QA-run can produce findings that prompt further code changes via a re-opened D2 round, but D3 itself doesn't commit code).

## Dependencies between dispatches

Sequential stack: D1 → D2 → D3.

- **D2 depends on D1.** Strictly speaking D2 and D1 touch different files (sql-builder vs ORM), so they're code-independent. But the workspace regression test in D2's "Done when" depends on `fns.ne` renaming being complete (D1's work) — otherwise existing `fns.ne` callsites would still typecheck-fail at the moment D2 runs. Sequential serialization keeps the workspace green at every commit.
- **D3 depends on D2.** Manual-QA needs the full code (including the cipherstash tightening which only fires after D1 and the LEGACY_ORDERING_METHODS preservation which only exists after D2).

No parallelization opportunity within this slice.

## Cross-references

### Failure modes threaded

- **F1 — Dual-shape support relocated under a new name.** D2 implementer might be tempted to recreate `COMPARISON_METHODS_META`-equivalent functionality under a new name (e.g. `LEGACY_COMPARISON_METHODS`, `BUILTIN_OP_FACTORIES`, etc.) inside `model-accessor.ts` to preserve the synthesis pattern. The grep gate at D2's "Done when" specifically catches this — any new `COMPARISON_METHODS`-style name appearing in the diff is a stop-condition. The `LEGACY_ORDERING_METHODS` map is the ONLY accepted preservation, and it's scoped to asc/desc (a 2-entry map with explicit "removed by slice 3b" annotation). Reference: [F1 in failure-modes.md](../../../../drive/calibration/failure-modes.md#f1-dual-shape-support-relocated-under-a-new-name).

- **F3 — Discovery via test suite instead of grep.** Each dispatch's consumer discovery is pre-grounded in the slice spec (the 11 `fns.ne` sites are named exhaustively; the 7 files referencing deleted symbols are named). Implementers re-grep at pre-flight to confirm no new sites appeared since the slice-spec snapshot.

- **F5 — Destructive git operations forbidden.** Standard prohibition across all three dispatches.

### Grep library entries used

- `rg 'fns\.ne\(' packages/ examples/ test/` — D1 final gate (0 hits after rename).
- `rg 'BuiltinFunctions|createBuiltinFunctions' packages/ examples/ test/` — D1 final gate (0 production hits; doc-comment hits in `family-sql/src/core/query-operations.ts` UPDATED, not deleted).
- `rg 'COMPARISON_METHODS|ComparisonMethodFns|ComparisonMethodMeta|MethodFactory|scalarComparisonMethod|listComparisonMethod' packages/3-extensions/sql-orm-client/src/` — D2 final gate, F1 anti-pattern check.
- `rg 'LEGACY_ORDERING_METHODS' packages/` — D2 SDoD10 gate (exactly one file).
- `rg 'BuiltinFunctions' packages/2-sql/9-family/src/core/query-operations.ts` — D1 confirms doc-comment updates (the comments either describe history without the name, or the name is wrapped in a "previously known as" past-tense framing).

## Slice-DoD reachability

Every condition in the slice-DoD is covered by one or more dispatches:

| Slice-DoD condition | Covered by |
|---|---|
| **SDoD1.** All gates pass. | All three dispatches contribute; final pass on D2 (the workspace regression). D3's manual-QA gate is separate. |
| **SDoD2.** Every pre-named edge case handled per its disposition. | Distributed per the edge-cases-covered tables in each dispatch. |
| **SDoD3.** Reviewer verdict: accept. | D3's reviewer round is the slice-level verdict. |
| **SDoD4.** Manual-QA script + run report + no Blocker findings. | D3 (the entire dispatch's value-add). |
| **SDoD5.** No out-of-scope touches. | Intent-validation gate in each dispatch + the explicit "Files in play" enumeration. |
| **SDoD6.** AC1 — legacy surfaces gone (repo-wide search). | D1 (sql-builder deletion grep) + D2 (sql-orm-client deletion grep). |
| **SDoD7.** AC3 — trait gating symmetric. | D1 (the cipherstash tightening test). |
| **SDoD8.** AC4 — per-column ORM method surface unchanged. | D2 (the surface-unchanged check). |
| **SDoD9.** AC9 — end-to-end ORM queries build, byte-identical SQL. | D2 (workspace regression test pass). |
| **SDoD10.** `LEGACY_ORDERING_METHODS` in exactly one file. | D2 (the SDoD10 grep gate). |
| **SDoD11.** `fns.ne` gone from production code. | D1 (the `rg 'fns\.ne\('` gate). |

## Risks

1. **D1 NFR2 typecheck-time regression.** Removing the `BuiltinFunctions<CT> &` intersection in `Functions<QC>` could regress `pnpm typecheck` wall-clock on the demo. D1's "Done when" gate measures this. If regression > ~10%, the project spec's mitigation is "investigate shared `infer` slots / distributive conditionals." If the implementer surfaces a regression, the orchestrator may need to amend D1's brief (or open a follow-up round in slice 3) to add the mitigation.

2. **D2 AC4 surface-unchanged check methodology.** The "per-codec method count must match before and after" check requires the implementer to baseline the per-codec accessor surface pre-D2. The protocol: stash D2's diff, run a small test that inspects `Object.keys(accessor[col])` for each codec, record counts, unstash, re-run, diff. If the counts don't match, surface to orchestrator. If they match but a method name changed, surface — methods must be present under the same name.

3. **D2 F1 anti-pattern.** The grep gate catches `COMPARISON_METHODS`-style names but not all conceivable rebranding (e.g. `STATIC_OPERATIONS`, `INLINE_METHOD_REGISTRY`). The reviewer's intent-validation must read the D2 diff for net-new factories of any kind. The slice-DoD's "no out-of-scope touches" + the intent-validation gate jointly cover this; the reviewer is expected to spot-check.

4. **D2 `ComparisonMethods<T, Traits>` derivation re-sourcing.** `ComparisonMethods<T, Traits>` is the public-facing type wrapper that today filters its method set by reading from `COMPARISON_METHODS_META`. After deletion, it must re-source the filter from the registry-derived `FieldOperations` (or equivalent). The re-sourcing is a type-level refactor that's easy to get subtly wrong (e.g. omitting `isNull`/`isNotNull` from the resulting union). The reviewer must spot-check the type-level surface against the AC4 promise.

5. **D3 manual-QA Blocker finding scenarios.** If the cipherstash tightening test surfaces a less-than-useful diagnostic message (e.g. TypeScript's error is opaque), the manual-QA may surface this as a ⚠️ Should-fix or 🛑 Blocker. The disposition is the orchestrator's call: improve the error in this slice (adding a `& { __error_hint?: 'cipherstash codec does not declare equality trait' }` type-level hint, for example), defer to a follow-up, or accept the diagnostic as-is. The slice-DoD says "no 🛑 Blocker findings" — a Blocker means re-opening D1 or D2.

6. **Workspace test set boundary.** D1 and D2 each run a workspace regression test on the same package set (sql-builder + sql-orm-client + postgres + sqlite + cipherstash + pgvector + sql-runtime). If a regression slips through D1 but D1 PASSED, D2's regression run catches it as "regression introduced by D1's commits." The orchestrator then re-opens D1, not D2. The reviewer should distinguish "D2 introduced this" from "D1 introduced this and D1's gate missed it" via `git blame` / commit inspection.
