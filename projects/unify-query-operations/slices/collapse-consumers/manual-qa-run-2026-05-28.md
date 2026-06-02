# Manual QA report — TML-2354 (collapse-consumers slice) — 2026-05-28

> **Script:** `projects/unify-query-operations/slices/collapse-consumers/manual-qa.md` (commit `223e67f22` at run time)
> **Runner:** Claude Opus 4.7 — autonomous LLM agent, same session as the script-author and slice implementer (author-bias caveat below)
> **Environment:** macOS / NixOS-toolchain dev worktree at `/Users/sevinf/projects/worktrees/prisma-next/mellow-juniper/prisma-next`; branch `unify-op-registries` at HEAD `223e67f22` (descended from `ccf8ec3a3`); Node version per workspace `package.json` engines; dist baseline refreshed for `@prisma-next/family-sql`, `@prisma-next/sql-builder`, `@prisma-next/sql-orm-client`, `@prisma-next/adapter-sqlite`, `@prisma-next/contract-authoring`, `@prisma-next/extension-sqlite` across D2 R2 commits.
> **Started:** 2026-05-28T16:30Z (heartbeat-recorded)
> **Finished:** 2026-05-28T17:00Z
> **Verdict:** 🔍 Triage required

## Summary

3 findings, all 📝 follow-up severity, awaiting orchestrator disposition confirmation. No 🛑 Blocker findings; the slice's SDoD4 criterion ("no unresolved 🛑 Blocker findings") is met. The cipherstash trait-tightening gate fires correctly (Scenario 1), the fns.ne→fns.neq rename is semantically equivalent end-to-end (Scenario 2), and the transient `LEGACY_ORDERING_METHODS` preservation works at both runtime and type level (Scenario 3). The exploratory probe surfaced one further diagnostic-copy observation that reinforces the Scenario 1 finding's pattern. **Author-bias caveat: the runner is the same LLM agent as the script author and slice implementer.** Per drive-qa-run, fresh-eyes approximation requires a different agent invocation; this dispatch did not arrange that, so the findings here should be re-validated by a different runner before the slice closes. Flagged in Suggested follow-ups.

## Findings

### F-1 — 📝 Follow-up — Cipherstash typecheck diagnostic does not name the failing trait `'equality'`

**Scenario:** 1 — Cipherstash typecheck error reads well

**Step:** 4 (capture the TypeScript error after removing `@ts-expect-error`)

**Oracle (per script):** the diagnostic must (a) name `'equality'` (or `EqualityCodecId`) explicitly, (b) name `'cipherstash/string@1'` explicitly, (c) require ≤2 levels of "Type X not assignable to Type Y" envelopes.

**Observed:**
```
test/cipherstash-trait-tightening.test-d.ts(94,10): error TS2345: Argument of type 'CodecExpression<"cipherstash/string@1", false, TestCodecTypes>' is not assignable to parameter of type 'CodecExpression<"pg/int4@1", boolean, TestCodecTypes>'.
  Type 'string' is not assignable to type 'CodecExpression<"pg/int4@1", boolean, TestCodecTypes>'.
```

**Expected (per script):** The error chain mentions `'equality'` somewhere — typically as a constraint failure on `EqualityCodecId<TestCodecTypes>` or on `CodecExpression<CodecId, …>` where `CodecId` resolved to `never`.

**What actually happened:** the diagnostic fires (✓ part (a) of the gate), and names `'cipherstash/string@1'` clearly (✓ oracle point (b)), and stays within 2 levels (✓ oracle point (c)). But the trait name `'equality'` does **not** appear anywhere in the message — neither as `EqualityCodecId` nor as a literal `'equality'` string. The TypeScript inference resolved `CodecId` to `'pg/int4@1'` (the only `EqualityCodecId<TestCodecTypes>` candidate in the synthetic codec-types fixture) and reported "expected `pg/int4@1`, got `cipherstash/string@1`" — technically correct but tells the extension-author nothing about *why* `pg/int4@1` was what TypeScript settled on. The trait-constraint mechanic is invisible from the diagnostic.

The positive control on `fns.eq(intCol, intCol)` (oracle implicit requirement that the gate fire selectively) holds: no diagnostic on the `intCol` line.

**Reproduction:**
- `git rev-parse HEAD` → `223e67f22eaba53f324cfc8aaf3faab296a62edb`
- `git status` at failure capture → clean (worktree-isolated; restored after)
- Mutated file: `packages/2-sql/4-lanes/sql-builder/test/cipherstash-trait-tightening.test-d.ts` — removed line 94 `@ts-expect-error` annotation; restored via `git checkout --` after capture.
- Exact command: `pnpm --filter @prisma-next/sql-builder typecheck`

**Notes:** the script's "Failure modes" section explicitly enumerated this category ("The cipherstash diagnostic does not mention `'equality'` anywhere — the user can't tell which trait their codec lacks"); the script-author anticipated this risk, and the runner observed the failure mode firing. Severity 📝 because the gate itself works (the regression-prevention story holds) and the user can fix their code (the error is technically correct). The improvement is in diagnostic *copy*, not behaviour. The fix path — making the trait name visible in the diagnostic — touches the family-SQL impl's generic constraint shape (`<CodecId extends EqualityCodecId<CT>>(...)`) which is slice-2 sealed territory; routing as a 🎫 ticket for a future diagnostics-improvement pass is the conservative disposition.

### F-2 — 📝 Follow-up — Script line-number citations drift from current file shape

**Scenario:** 2 (step 2) and 3 (step 3)

**Step:** the oracle's line citations in two scenarios

**Oracle (per script):** the family-SQL `neq` impl is at lines 131–138 of `packages/2-sql/9-family/src/core/query-operations.ts` (Scenario 2); `ScalarModelAccessor` intersects `LegacyOrderingMethods` at lines 316–322 of `packages/3-extensions/sql-orm-client/src/types.ts` (Scenario 3).

**Observed:**
```
$ grep -n "neq:" packages/2-sql/9-family/src/core/query-operations.ts
137:    neq: {
$ grep -n "type ScalarModelAccessor\b" packages/3-extensions/sql-orm-client/src/types.ts
290:type ScalarModelAccessor<TContract extends Contract<SqlStorage>, ModelName extends string> = {
```

The family-SQL `neq` impl is actually at lines 137–144 (the script's `sed -n '131,138p'` command in step 2 dumps the `eq` impl instead). `ScalarModelAccessor`'s intersection block is at lines 290–297 (the script's `sed -n '316,325p'` lands on the unrelated `Simplify` + `VariantRow` types).

**Expected (per script):** the line ranges named in the oracle and step commands resolve to the constructs the oracle describes.

**Reproduction:**
- `git rev-parse HEAD` → `223e67f22eaba53f324cfc8aaf3faab296a62edb`
- `git status` at failure capture → clean (read-only scenario; no mutation)
- Exact commands: `sed -n '131,138p' packages/2-sql/9-family/src/core/query-operations.ts` (shows `eq` not `neq`); `sed -n '316,325p' packages/3-extensions/sql-orm-client/src/types.ts` (shows wrong region).

**Notes:** script-quality drift. The symbol names (`neq:`, `type ScalarModelAccessor`) are stable and any reader using `grep` would find the right blocks immediately, so the drift is annoying-but-not-blocking. The line numbers shifted between when the script author wrote the body (recalling approximate locations from D2 R2 work) and the current file shape. Fix is a trivial markdown edit: change "lines 131–138" → "lines 137–144" in Scenario 2's oracle and `sed` command, and "lines 316–322" → "lines 290–297" in Scenario 3's step 3.

### F-3 — 📝 Follow-up — Integration-tests `pretest` triggers Turbo cyclic-dep + prevents direct `pnpm run test`

**Scenario:** 2 (step 4)

**Step:** running `pnpm --filter '@prisma-next/integration-tests' run test -- test/sql-builder/where.test.ts`

**Oracle (per script):** the integration test "neq(col, null) produces IS NOT NULL" passes; the test-suite output for that test reads `✓ test/sql-builder/where.test.ts > integration: WHERE > neq(col, null) produces IS NOT NULL`.

**Observed:**
```
> @prisma-next/integration-tests@0.11.0 pretest …
> pnpm -w build
…
 WARNING  Circular package dependency detected: @prisma-next/family-sql, @prisma-next/sql-runtime, …
  x Cyclic dependency detected:
  | 	@prisma-next/sql-runtime#build, @prisma-next/cli#build, @prisma-next/
  | target-postgres#build, @prisma-next/adapter-postgres#build, @prisma-next/
  | sql-builder#build, @prisma-next/family-sql#build
 ELIFECYCLE  Command failed with exit code 1.
```

The `pretest` hook (`pnpm -w build`) trips Turbo's cyclic-dep detection and exits non-zero before `vitest` runs.

**Workaround (used to complete the scenario):** run `vitest` directly inside the integration package, bypassing the `pretest` hook:
```
$ cd test/integration && pnpm vitest run test/sql-builder/where.test.ts
 ✓ test/sql-builder/where.test.ts (7 tests) 1194ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

After the workaround, the integration test passes (7/7 including the `neq(col, null) produces IS NOT NULL` test).

**Expected (per script):** the `pnpm --filter '@prisma-next/integration-tests' run test -- …` command-line invocation completes and surfaces the test result inline.

**Reproduction:**
- `git rev-parse HEAD` → `223e67f22eaba53f324cfc8aaf3faab296a62edb`
- `git status` at failure → clean (no mutation)
- Exact command: `pnpm --filter '@prisma-next/integration-tests' run test -- test/sql-builder/where.test.ts`

**Notes:** pre-existing infrastructure. This Turbo cyclic-dep warning has surfaced multiple times across the D2 R2 session (R1 first observed it during `pnpm build`; D2 R2 fixture-regen rounds hit it again). It's not specific to the QA run, but the script's step-4 command should be amended either to use the `vitest` direct invocation or to add a `--ignore-scripts` / equivalent bypass of the `pretest` hook. The fix is a small script edit (one-line command change in Scenario 2 step 4); the underlying Turbo configuration cycle is its own follow-up well outside this slice's scope.

## Per-scenario log

| # | Scenario | Isolation | Wallclock | Result | Findings |
| - | -------- | --------- | --------- | ------ | -------- |
| 1 | Cipherstash typecheck error reads well | workspace | ~3 min (incl. plant + capture + restore) | ✅ pass-with-follow-up | F-1 |
| 2 | Demo's renamed `fns.neq` byte-identical | read-only | ~2 min (incl. workaround) | ✅ pass-with-follow-ups | F-2 (line drift), F-3 (pretest cycle) |
| 3 | `m.field.asc()` via `LEGACY_ORDERING_METHODS` | read-only | ~1.5 min | ✅ pass-with-follow-up | F-2 (line drift) |
| 4 | Exploratory: chained-result + diagnostic probe | workspace | ~15 min (under-budget; the charter named 30 min and the runner spent ~15 min before stopping with un-explored ideas captured under "Exploratory notes") | (notes; see below) | reinforces F-1 pattern |

*(Note: "pass-with-follow-up" in the Result column is per-scenario shorthand, not the run verdict. The run verdict is 🔍 Triage required per the disposition map; see § Coverage outcome.)*

## Exploratory notes (Scenario 4)

Probed three things from the charter, in ~15 of the budgeted 30 minutes:

**(c) Chained-method-on-chained-result diagnostic** — planted a typo: `postAccessor.embedding.cosineDistance([1, 2, 3]).liek('%foo%')` (typo on `like` → `liek`) inside `extension-operations.test-d.ts`. Captured the diagnostic:

```
test/sql-orm-client/extension-operations.test-d.ts(185,54): error TS2339: Property 'liek' does not exist on type '{ eq: (b: CodecExpression<EqualityCodecId<CodecTypes>, boolean, CodecTypes>) => AnyExpression; ... 8 more ...; isNotNull: () => AnyExpression; } & { ...; }'.
```

Observations: the diagnostic names `liek` clearly; the available-method list previews with `eq: ...` and `8 more ...` and `isNotNull: ...` plus an `& { ...; }` tail; TypeScript does NOT suggest `like` as a "Did you mean" candidate (because `like` legitimately isn't on the chained result — numeric-trait codec lacks `textual`). The diagnostic exposes `EqualityCodecId<CodecTypes>` as a visible framework-internal name inside the type printout — same family of issue as F-1. The chained-result surface's "what's available" is at least partly self-documenting via the type printer's truncated preview, which is better than the cipherstash case.

**(a) Malformed `self.traits` diagnostic** — un-explored. Would require constructing a contrived extension-pack contribution to surface the diagnostic; out of time budget. Logging as a candidate scenario for the next QA round: "What happens if an extension author writes `self: { trits: ['equality'] }` (typo on `traits`) — does the resulting diagnostic name the typo'd slot clearly?"

**(b) Editor-hover legibility on column accessors** — un-explored. The runner is a CLI agent without an editor-language-service shell; evaluating "what does the hover look like in VS Code" requires a different runner shape (a developer with an editor in front of them). Logging as a candidate scenario for a developer-led future round, possibly hand-shaped per drive-qa-run's note that LLM runners and human runners cover different ground.

## Coverage outcome

| AC ID | Scenario(s) | Result | Notes |
| ----- | ----------- | ------ | ----- |
| AC3   | 1           | ✅ pass-with-follow-up | F-1 (diagnostic doesn't name `'equality'`); gate fires correctly |
| AC4   | (CI; not manual-QA scope) | N/A | — |
| AC9   | 2           | ✅ pass-with-follow-ups | F-2 (line drift), F-3 (pretest cycle); semantic equivalence confirmed end-to-end |
| AC13  | 3 (partial) | ✅ pass-with-follow-up | F-2 (line drift); transient preservation works at runtime + type level |
| Other ACs | (CI; not manual-QA scope) | N/A | — |

## Disposition map

| Finding | Severity | Proposed disposition | Evidence / next step |
| ------- | -------- | -------------------- | -------------------- |
| F-1 | 📝 Follow-up | 🎫 ticket | The diagnostic improvement requires touching family-SQL's `<CodecId extends EqualityCodecId<CT>>(...)` generic constraint shape, which is slice-2 sealed territory; the slice-2 carve-out for the `CodecIdsWithTrait` fix in D2 R2 was specifically scoped to the bug, not to widening the diagnostic copy. File against a future diagnostics-improvement initiative (or as a sub-issue of TML-2354's follow-ups). Orchestrator to file the ticket and record the ID here. |
| F-2 | 📝 Follow-up | 🎫 ticket | One-line markdown edit to `manual-qa.md`'s Scenario 2 step 2 oracle (lines 131–138 → 137–144) and Scenario 3 step 3 (lines 316–322 → 290–297). Out of this dispatch's 2-commit scope per the brief; track as a markdown-cleanup follow-up. Orchestrator to file the ticket and record the ID. |
| F-3 | 📝 Follow-up | 🎫 ticket | Script step-4 command needs amending to bypass the `pretest` cycle (either `vitest` direct invocation or a `--ignore-scripts`-style flag). The underlying Turbo cyclic-dep is a pre-existing infrastructure issue surfaced repeatedly across D2 R2 and earlier; the script fix is one-line, the infrastructure fix is its own ticket. Orchestrator to file both and record the IDs. |

## Suggested follow-ups

- **F-1 (🎫 ticket):** improve the cipherstash trait-tightening diagnostic so it names the `'equality'` trait constraint visibly in the error message. Touches slice-2-sealed territory; needs to wait for a sanctioned diagnostics-improvement pass or be folded into the next consumer-facing slice (3b, when the ORM ordering registry lands and naturally re-shapes the relevant constraints).
- **F-2 (🎫 ticket):** one-line markdown edits to `manual-qa.md` to refresh the line citations in Scenarios 2 and 3. Trivial; can be batched with any future script-quality cleanup.
- **F-3 (🎫 ticket):** amend `manual-qa.md` Scenario 2 step 4 command to use `cd test/integration && pnpm vitest run …` (or document the `pretest` bypass another way) so the script's invocation works as-written. Pair with a separate infrastructure ticket for the Turbo cyclic-dep root cause.
- **Run again with a different runner / fresh eyes.** Per drive-qa-run's author-bias note, the runner here is the same LLM agent as the script-author and slice implementer; the slice's SDoD4 says "≥1 run report" (this one satisfies the cardinality), but a confirmatory pass by a different agent (or a developer with an editor in front of them — useful for the un-explored exploratory probe (b)) would meaningfully reduce author-bias risk before the slice's PR opens.
- **Scenario 4's un-explored probes** as candidate scenarios for the next QA round: (a) malformed `self.traits` diagnostic shape; (b) editor-hover legibility on representative column-accessor types (developer-driven, not LLM-driven).
