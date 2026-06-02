# Manual QA — TML-2354 (collapse-consumers slice)

> **Be the extension-author.** You are an outside developer building (or maintaining) an extension on top of `@prisma-next/*`. You don't read framework internals before reaching for the SQL builder or the ORM column accessor — you read the diagnostics they emit, the demo's call sites, and the shapes the column-accessor type surfaces in your editor. This script walks you through the four user-visible promises the slice ships and asks you to judge whether the promises *read* the way they should from the outside.
>
> **Out of scope of this script.** Re-running CI's `pnpm test:packages` / `pnpm typecheck` / `pnpm lint:deps` against today's clean tree. Those passed on the implementer's machine and are CI's responsibility; re-running them locally only proves your machine matches CI. The user-meaningful versions of those checks live as the negative-control scenario (Scenario 1) and the integration probes (Scenarios 3 and 4).
>
> **Spec:** `projects/unify-query-operations/slices/collapse-consumers/spec.md`
> **Plan:** `projects/unify-query-operations/slices/collapse-consumers/plan.md`
> **Project spec:** `projects/unify-query-operations/spec.md` (AC3, AC4, AC9, AC13 are the slice-relevant ACs)
> **PR:** none yet — single PR at project close per the amended delivery model.

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | -------- | -------------- | --------- | ------ |
| 1 | Cipherstash typecheck error reads well (negative control + positive control) | The trait-tightening gate fires on `fns.eq(cipherstashCol, cipherstashCol)` with a diagnostic that names the failing constraint clearly, and the symmetric `fns.eq(intCol, intCol)` typechecks unchanged | workspace | AC3 |
| 2 | Demo's renamed `fns.neq` call sites lower to byte-identical SQL by construction | The `fns.ne → fns.neq` rename across the demo's `cross-author-similarity` query is a name-only change; the underlying registry op + the integration test for `fns.neq` confirm runtime SQL equivalence | read-only | AC9 |
| 3 | `m.field.asc()` still works inside `orderBy` callbacks via `LEGACY_ORDERING_METHODS` | The transient asc/desc surface preserves the orderBy callback's `.asc()` / `.desc()` surface on column accessors; runtime + type-level tests both green | read-only | AC13 (partial — slice 3b's territory completes the split) |
| 4 | Extension-author exploratory: probe the chained-result surface and diagnostic copy | Surfaces unknown unknowns in the post-R2 column accessor + chained-result diagnostics from an extension-author lens | workspace | (charter; no specific AC) |

> Scenario 1 is a **(negative control)** — plants a violation (removing the `@ts-expect-error` annotation) and observes the gate fire. Scenarios 1 and 4 are **(judgement)** — runner evaluation of diagnostic quality against an explicit oracle. Scenario 4 is **(exploratory)** — time-boxed charter, no scripted steps.
>
> The **Isolation** column tells the runner how to schedule the scenario in parallel: `tmpdir` (own scratch dir, shared read-only clone), `workspace` (own `git worktree`), `read-only` (no isolation needed), or `external` (network-bound; rate-limit-aware).

## Pre-flight

1. Confirm `git rev-parse HEAD` resolves to `ccf8ec3a3` or later (the final D2 R2 commit). If you're on a newer commit, confirm it's a descendant of `ccf8ec3a3` and that no commit after it touched `packages/2-sql/4-lanes/sql-builder/`, `packages/2-sql/9-family/`, or `packages/3-extensions/sql-orm-client/src/`.
2. Confirm `git status` is clean. If it isn't, stash or commit first — the script's negative-control scenario mutates a tracked file inside a worktree, so the user's checkout must be clean at the start so the report's `git status` evidence is unambiguous.
3. Confirm the package dist baseline is current. This session has documented three partial-dist gotchas (R1 `contract-authoring`, R2 `extension-sqlite`, R2 `adapter-sqlite`); avoid a fourth here. Run `pnpm build` (or, if that's too heavy, at minimum `pnpm --filter @prisma-next/family-sql --filter @prisma-next/sql-builder --filter @prisma-next/sql-orm-client --filter @prisma-next/adapter-postgres --filter @prisma-next/adapter-sqlite --filter @prisma-next/extension-sqlite --filter @prisma-next/contract-authoring build`). Confirm `pnpm fixtures:check` exits 0 after build — that's the canary that downstream consumers can resolve the dists.
4. Confirm node version satisfies the root `package.json`'s `engines.node` constraint (do not switch via `nvm`/`fnm`; report a misconfigured shell as a finding instead).
5. Allocate per-scenario isolation contexts per `drive-qa-run`'s § 3a — shared read-only clone for `read-only` / `tmpdir` scenarios, fresh `git worktree --detach` per `workspace` scenario.

## Scenario 1 — Cipherstash typecheck error reads well (negative + positive control)

**What you're proving from the user's seat:** an extension-author building on top of `@prisma-next/sql-builder` types out `fns.eq(myCipherstashColumn, myCipherstashColumn)` in their editor. They expect the TypeScript error message to (a) fire at all, (b) name the constraint that failed (the missing framework `equality` trait), and (c) point them at the codec id of the failing argument so they know which of their fields tripped the gate. CI proves (a) — the `@ts-expect-error` annotation on `cipherstash-trait-tightening.test-d.ts` keeps the suite green. The user-meaningful versions are (b) and (c), which require *reading the actual diagnostic*. This scenario is the negative-control half (plant the violation by removing the annotation, observe the diagnostic) plus the positive control (`fns.eq(intCol, intCol)` — the symmetric trait-bearing case that must still typecheck).

**Covers:** AC3.

**Isolation:** `workspace` — the scenario edits a tracked source file (`cipherstash-trait-tightening.test-d.ts`) inside a worktree so the runner can read TypeScript's actual diagnostic message without modifying the user's live checkout.

**Oracle:** the diagnostic must:
- Name `'equality'` (or `EqualityCodecId`) explicitly somewhere in the message — it's the trait the cipherstash codec lacks, and the user's mental model of "why did this fail" depends on seeing the trait name.
- Name `'cipherstash/string@1'` (or its equivalent `CodecId` resolution to a non-includable value, typically `never`) — the user needs to know which codec id was rejected.
- Not require the user to recursively chase 3+ `Type '<X>' is not assignable to type '<Y>'` envelopes to find (a) and (b). Two levels of `Type … is not assignable to …` framing is acceptable; deeper is a finding.

Coverage boundary: this scenario probes the cipherstash-codec-shaped negative case (the codec advertises only `cipherstash:equality`, not the framework-canonical `equality`). It does NOT prove the diagnostic reads well for every possible trait mismatch — only the one we constructed. A trait the user invented in their own extension (e.g. `myorg/equality`) would surface a structurally similar message; whether it does so usefully is outside this scenario's scope.

**Preconditions:**
- Workspace worktree is fresh from `HEAD` (`git worktree add --detach $PN_QA_WORKTREES/scenario-1 HEAD`).
- `pnpm install` is up to date in the worktree (the root install at pre-flight covers this when the worktree shares the workspace `node_modules`; if it doesn't, run `pnpm install --frozen-lockfile` inside the worktree).
- `pnpm --filter @prisma-next/sql-builder build` has been run in the worktree at least once (the test-d file's imports resolve through `dist/`; a stale dist would shift the diagnostic in ways unrelated to the slice).

### Steps

1. Open `packages/2-sql/4-lanes/sql-builder/test/cipherstash-trait-tightening.test-d.ts` in the worktree.
2. Locate the `@ts-expect-error cipherstash codec lacks the framework 'equality' trait` annotation (~line 89).
3. Delete the annotation line. Save.
4. From the worktree root: `pnpm --filter @prisma-next/sql-builder typecheck`.
5. Capture the full TypeScript error block emitted for the modified test (the lines starting with `test/cipherstash-trait-tightening.test-d.ts(<line>,<col>): error TS…`).
6. Without restoring the file, also confirm the *other* `fns.eq` call earlier in the file (`fns.eq(intCol, intCol)`) does **not** produce a diagnostic — verifies the gate fires selectively (positive control).
7. Restore the file (see § Restore).

### What you should see

- A single TypeScript error message anchored at the `fns.eq(cipherstashCol, cipherstashCol)` line.
- The error chain mentions `'equality'` somewhere — typically as a constraint failure on `EqualityCodecId<TestCodecTypes>` or on `CodecExpression<CodecId, …>` where `CodecId` resolved to `never`.
- The error chain mentions `'cipherstash/string@1'` somewhere — either as the source type that was rejected, or as the codec id that didn't bind.
- The `fns.eq(intCol, intCol)` call earlier in the file does NOT produce a diagnostic on the same `pnpm typecheck` run. (Note: the `@ts-expect-error` you removed was on the cipherstash line only; the int4 line never had one.)
- The error envelope's depth is judgement-territory — call out if you have to chase more than two layers of "Type X not assignable to Type Y" to recover the trait name and codec id.

### Failure modes (anything matching these is a finding the runner classifies)

- No diagnostic fires on the cipherstash line after the annotation is removed (the gate doesn't gate — original-bug regression class).
- The cipherstash diagnostic does not mention `'equality'` anywhere — the user can't tell which trait their codec lacks.
- The cipherstash diagnostic does not mention `'cipherstash/string@1'` anywhere — the user can't tell which of their codecs tripped the gate.
- The `fns.eq(intCol, intCol)` line ALSO produces a diagnostic — the positive control fails, meaning the gate is over-firing.
- The diagnostic mentions an internal symbol name (`CodecIdsWithTrait`, `OpMatchesField`, an internal `infer` variable name) at the top of the error chain instead of as deep context — surfaces framework internals before the user-meaningful constraint.
- The error chain requires >2 layers of `Type '…' is not assignable to type '…'` to reach the trait name and codec id (depth-of-diagnostic judgement).

### Restore (mutates a tracked file)

1. Discard the edit: `git -C $PN_QA_WORKTREES/scenario-1 checkout -- packages/2-sql/4-lanes/sql-builder/test/cipherstash-trait-tightening.test-d.ts`.
2. Confirm clean: `git -C $PN_QA_WORKTREES/scenario-1 status` returns no working-tree changes.
3. Worktree itself is torn down at end-of-run per `drive-qa-run`'s § 3b.

## Scenario 2 — Demo's renamed `fns.neq` call sites lower to byte-identical SQL by construction

**What you're proving from the user's seat:** an extension-author who follows the demo to learn the SQL-builder DSL needs to know that the recent `fns.ne → fns.neq` rename (the only user-visible code change in D1 of this slice) does not change the SQL the demo emits. Without that confirmation, anyone copying the demo's query patterns into their own extension could quietly emit a different operator and chase a runtime difference they didn't expect. CI's `where.test.ts` integration test covers `fns.neq` end-to-end (executes against a real driver, asserts row counts) — this scenario adds the *judgement* layer over that: read the demo's three rename sites, read the family-SQL registry's `neq` impl, confirm by construction the SQL is identical, and run the integration test as the executable sanity check.

**Covers:** AC9.

**Isolation:** `read-only` — the scenario reads source files and runs an integration test that doesn't mutate the working tree.

**Oracle:** semantic equivalence by construction, verified by execution:
- The family-SQL registry's `neq` implementation at `packages/2-sql/9-family/src/core/query-operations.ts` (lines 131–138) is `BinaryExpr('neq', ...)` plus the `null`-coalescing branch. The rename from `fns.ne` to `fns.neq` is a *name change at the call-site proxy*; the resolved registry impl is identical. SQL lowering of `BinaryExpr('neq', ...)` produces `<>` regardless of what the call-site proxy was named — that's the by-construction equivalence claim.
- The integration test `test/integration/test/sql-builder/where.test.ts:65-75` ("neq(col, null) produces IS NOT NULL") executes `fns.neq(f.invited_by_id, null)` against PGlite and asserts the row count. A green run confirms the runtime SQL is correct end-to-end.
- The demo's three rename sites at `examples/prisma-next-demo/src/queries/cross-author-similarity.ts:44, 54` all use the same `fns.neq(<col-or-expr>, <col-or-value>)` call shape exercised by the integration test.

The composition of these three reads + the test run is the byte-identical proof: same registry op resolves at runtime regardless of the source-code spelling, same SQL emitted, demonstrated end-to-end on a real driver.

**Preconditions:**
- Read-only access to the shared workspace clone is sufficient.
- The integration test setup (`setupIntegrationTest()` in `test/integration/test/sql-builder/setup.ts`) bootstraps PGlite in-memory; no external DB needed.

### Steps

1. Read the three rename sites in the demo: `grep -n "fns\.neq" examples/prisma-next-demo/src/queries/cross-author-similarity.ts`. Confirm three hits at the line numbers noted in the oracle.
2. Read the family-SQL `neq` impl: `sed -n '131,138p' packages/2-sql/9-family/src/core/query-operations.ts`. Confirm the impl is `BinaryExpr('neq', ...)` (modulo the null-branch).
3. Confirm no `fns.ne` references remain in production code: `rg 'fns\.ne\b' packages/ examples/ test/ -g '!*.test*'`. Expected output: zero hits.
4. Run the integration test that exercises `fns.neq` end-to-end: `pnpm --filter '@prisma-next/integration-tests' run test -- test/sql-builder/where.test.ts`. Capture the test-suite output for the lines mentioning `neq`.

### What you should see

- Three `fns.neq` call sites in `cross-author-similarity.ts` at lines 44, 54 (two on line 54 in a single `fns.and(...)` composition).
- The family-SQL `neq` impl at lines 131–138 reads `impl: (a, b) => { if (b === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(a))); ... return boolExpr(binaryWithSharedCodec(a as ExprOrVal, b as ExprOrVal, 'neq')); }` — i.e. produces a `BinaryExpr` with op `'neq'` (or a `NullCheckExpr` for the null-coalescing case). The `'neq'` literal is what lowers to SQL `<>`.
- The `rg 'fns\.ne\b'` for production code returns zero hits — the rename is complete.
- The integration test "neq(col, null) produces IS NOT NULL" passes; the test-suite output for that test reads `✓ test/sql-builder/where.test.ts > integration: WHERE > neq(col, null) produces IS NOT NULL` (or equivalent).

### Failure modes (anything matching these is a finding the runner classifies)

- Any `fns.ne` reference remains in production code (the rename is incomplete) — surfaces an inconsistency that contradicts D1's commit message and slice spec SDoD11.
- The integration test "neq(col, null) produces IS NOT NULL" fails on the current branch — the runtime SQL for `fns.neq` is broken.
- The family-SQL `neq` impl emits something other than `BinaryExpr('neq', ...)` (e.g. the lowering accidentally fires through a renamed `'ne'` op-code, producing different SQL).

(No restore — read-only scenario.)

## Scenario 3 — `m.field.asc()` still works inside `orderBy` callbacks via `LEGACY_ORDERING_METHODS`

**What you're proving from the user's seat:** an extension-author using the ORM collection surface writes `.orderBy(m => m.id.asc())`. The slice deletes `COMPARISON_METHODS_META` (which previously carried `asc`/`desc`) but preserves the user-visible behaviour via a transient `LEGACY_ORDERING_METHODS` map in `model-accessor.ts` that slice 3b will remove when the proper ORM ordering registry lands. This scenario confirms the transient preservation actually preserves — both at runtime (existing ORM integration tests that use `.asc()` continue to pass) and at the type level (the column-accessor type continues to expose `.asc()` / `.desc()` on `'order'`-trait codecs).

**Covers:** AC13 (partial; slice 3b's territory completes the orderBy/WHERE accessor split per AC13 (b) — the "WHERE accessor does not expose asc/desc" half of the AC).

**Isolation:** `read-only` — runs existing tests against the shared workspace clone.

**Oracle:**
- `packages/3-extensions/sql-orm-client/src/model-accessor.ts` contains `LEGACY_ORDERING_METHODS` (top of file, ~line 28-55) gated on the `'order'` trait. The runtime synthesis at `attachOperationMethods` (~line 209-230) attaches `asc` / `desc` from this map to every column accessor whose codec declares the `'order'` trait.
- `packages/3-extensions/sql-orm-client/src/types.ts` contains `LegacyOrderingMethods<Traits>` (~line 128-145) — the type-level mirror — gated on `'order'` extends `Traits`. `ScalarModelAccessor` intersects it (~line 318) so the column-accessor type exposes `asc()` / `desc()` when the field's codec carries `'order'`.
- Runtime tests in `packages/3-extensions/sql-orm-client/test/` and `test/integration/test/sql-orm-client/` exercise `.asc()` / `.desc()` calls; if `LEGACY_ORDERING_METHODS` were broken, those tests would fail at typecheck or runtime.

**Preconditions:**
- Read-only access to the shared workspace clone is sufficient.
- The sql-orm-client package's `test:` script bootstraps its own fixtures; no external resources needed.

### Steps

1. Read `LEGACY_ORDERING_METHODS` in `packages/3-extensions/sql-orm-client/src/model-accessor.ts:28-55`. Confirm the JSDoc names "slice 3b" as the removal target and `'order'` as the gating trait.
2. Confirm the type-level mirror at `packages/3-extensions/sql-orm-client/src/types.ts:128-145`: `type LegacyOrderingMethods<Traits> = 'order' extends Traits ? { asc(): OrderByItem; desc(): OrderByItem } : Record<never, never>`.
3. Confirm `ScalarModelAccessor` intersects `LegacyOrderingMethods` at `packages/3-extensions/sql-orm-client/src/types.ts:316-322`.
4. Run the sql-orm-client package tests with the asc/desc-exercising suites filtered: `pnpm --filter @prisma-next/sql-orm-client test -- model-accessor query-plan-select collection.state`. These three files between them exercise `column.asc()` / `column.desc()` calls at runtime in the sql-orm-client package's own unit harness (no integration DB needed).
5. (Optional, if the integration DB harness is convenient) run `pnpm --filter '@prisma-next/integration-tests' run test -- test/sql-orm-client/extension-operations.test.ts` — that suite at lines 48 and 75 calls `.orderBy(p => p.embedding.cosineSimilarity(searchVec).desc())` / `.asc()`, exercising both the column-level and chained-result-level `LegacyOrderingMethods` surfaces.
6. (Optional, but high-judgement-value) read `packages/3-extensions/sql-orm-client/src/types.ts:128-145` again and ask: would an extension-author reading this for the first time (without context on slice 3b) understand the type is transient and why? The doc comment is the oracle for "is the transient surface signposted clearly".

### What you should see

- `LEGACY_ORDERING_METHODS` in `model-accessor.ts` carries a `**Removed by slice 3b**` JSDoc heading (the slice spec's named contract for the transient).
- `LegacyOrderingMethods<Traits>` in `types.ts` carries a parallel JSDoc that names `./model-accessor.ts` as the runtime mirror.
- Step 4 tests pass; the suite output reads `✓ test/model-accessor.test.ts (…)` / `✓ test/query-plan-select.test.ts (…)` / `✓ test/collection.state.test.ts (…)` and no test concerning `.asc` / `.desc` fails.
- Step 5 (if run) passes; the `cosineSimilarity(...).asc()` / `.desc()` integration test rows match expectation.
- The transient annotation reads clearly to a fresh reader — the "slice 3b removes this" rationale is legible from the JSDoc alone, without needing to read the slice spec.

### Failure modes (anything matching these is a finding the runner classifies)

- `LEGACY_ORDERING_METHODS` (the runtime value) or `LegacyOrderingMethods` (the type-level mirror) is missing from its named file — the transient surface isn't preserved.
- The transient is not annotated as transient (no "slice 3b" or equivalent removal-target callout in the JSDoc) — future maintainers wouldn't know to delete it as a pair when slice 3b lands.
- Any `model-accessor.test.ts`, `query-plan-select.test.ts`, or `collection.state.test.ts` test concerning `.asc()` / `.desc()` fails — the runtime synthesis is broken.
- The integration test (step 5) fails on a `.desc()` / `.asc()` line — the chained-result `LegacyOrderingMethods` mirror is broken.
- The JSDoc on either half of the pair refers to the deleted runtime by a name that no longer matches (e.g. references `COMPARISON_METHODS_META.asc` without context that it's been deleted) — the breadcrumb is stale.

(No restore — read-only scenario.)

## Scenario 4 — Exploratory: probe the extension-author chained-result and diagnostic surface

**Charter.** "Explore the post-R2 column-accessor + chained-result surface from an extension-author's editor for 30 minutes. Probe: (a) when an extension op's `self.traits` is malformed or absent, does the resulting diagnostic name the missing slot clearly? (b) does the column-accessor type, when hovered in an editor on a representative codec (`pg/int4@1`, `pg/text@1`, `cipherstash/string@1`), surface a comprehensible method set, or does it dump TypeScript intersection envelopes the user must mentally unfold? (c) does chaining `column.cosineDistance(v).<some-method>` produce useful diagnostics for both valid (gt, lt) and invalid (like, ilike) chained methods? Surface anything that reads poorly, looks surprising, or 'felt off' but you can't yet name."

**Covers:** (no specific AC; charters surface unknowns)

**Isolation:** `workspace` — exploration may involve typing into a sandboxed test file to inspect editor / `tsc` output. The worktree is allocated; the user's checkout stays clean.

**Time budget:** 30 minutes. Stop when the timer rings even if you have ideas left — log un-explored ideas as candidate scenarios for the next QA round.

**Notes capture:** write what you tried, what surprised you, anything that 'felt off' but you can't yet name. Findings discovered here get filed in the report's Findings section the same way scripted-scenario findings do.

### Failure modes (anything matching these is a finding the runner classifies)

- A diagnostic on a representative extension-author misuse (e.g. calling `like` on a numeric chained result) is incomprehensible without reading framework internals.
- The column-accessor's hovered type in an editor is dominated by internal symbol names (`FieldOperations`, `ChainedResultMethods`, `OpMatchesField`) rather than user-facing method signatures.
- The chained-result surface exposes methods the slice spec says it shouldn't (e.g. `asc()` on a chained-result of a non-`order`-trait codec) — silent surface widening.
- The doc comments on `LegacyOrderingMethods`, `ChainedResultMethods`, or `LEGACY_ORDERING_METHODS` read as if they were written for the implementer (slice-internal vocabulary) rather than a future maintainer.

(No restore inside the scenario; worktree torn down at end-of-run.)

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC1 (legacy surfaces gone) | CI grep covers it (SDoD6: `rg 'COMPARISON_METHODS_META\|BuiltinFunctions\|ComparisonMethodFns\|createBuiltinFunctions' packages/ examples/ test/` returns zero production hits). Re-running it here adds nothing. |
| AC2 (family registers via standard contributor surface) | Slice 2's territory; slice 2 closed before this slice opened. The family's `queryOperations()` factory already exists; slice 3 only collapses *consumers*. |
| AC4 (per-column ORM method surface unchanged) | Verified by the existing type-d tests in `packages/3-extensions/sql-orm-client/test/` (e.g. `annotations.types.test-d.ts`'s column-accessor probes; `extension-operations.test-d.ts`'s 14-method `.toHaveProperty()` fan). D2 R1's return shape reported the per-codec key set unchanged. Re-running the type-d suite here adds nothing CI doesn't already cover. |
| AC5 (`fns` surface still callable) | CI's `pnpm --filter @prisma-next/sql-builder test` exercises every `fns.<name>` call site. The cipherstash trait tightening from AC3 is the only intentional difference and is covered by Scenario 1. |
| AC6 (`isNull` / `isNotNull` reachable everywhere) | Existing test-d files and runtime tests in `family-sql/` and `sql-orm-client/` cover this. The slice doesn't change `isNull` / `isNotNull` semantics; they continue to declare `self: { any: true }`. |
| AC7 (no backward-compat shims) | Verified by `pnpm lint:deps` clean + the AC1 grep. CI covers both. |
| AC8 (HAVING surface is derived) | Slice 4's territory. `HavingComparisonMethods<T>` is explicitly preserved by this slice per the slice spec SDoD5; slice 4 deletes it. |
| AC10 (new ADR) | Slice 5's territory (project close-out). |
| AC11 (family contract emission) | Slice 2's territory + D1's fixture re-emit + D2 R2's fixture re-emit sweep. The 7-commit fixture-regen across D2 R2 forms the evidence trail; re-running emit here would only re-confirm. |
| AC12 (binary operator signatures gate by trait) | The cipherstash side is covered by Scenario 1; the broader trait-gating tests (gt/lt/gte/lte against `order`, like against `textual`) are CI typecheck territory. Adding scenarios for them here would re-validate CI's work without bringing the human-judgement layer Scenario 1 brings for cipherstash. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC3   | 1 |
| AC4   | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| AC9   | 2 |
| AC13  | 3 (partial: the `m.field.asc()` half — the slice spec defers the full orderBy/WHERE split to slice 3b) |
| Other ACs | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
