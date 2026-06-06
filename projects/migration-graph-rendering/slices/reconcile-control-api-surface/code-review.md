# Code review — `reconcile-control-api-surface` (TML-2780)

> Initial scaffold. The reviewer maintains this document across rounds. The orchestrator and implementer read it but do not edit it (except the orchestrator's § Subagent IDs / § Orchestrator notes).

## Summary

- **Current verdict:** SATISFIED (round 1)
- **Dispatches SATISFIED:** D1, D2, D3, D4
- **AC scoreboard totals:** 4 PASS / 0 FAIL / 0 NOT VERIFIED
- **Open findings:** 0
- **Open escalations:** 0

## Acceptance criteria scoreboard

> From `spec.md § Slice-specific done conditions`. Update every round.

| AC ID | Description (short) | Dispatch | Status | Evidence |
| ----- | ------------------- | -------- | ------ | -------- |
| AC-1 | Glossary carries no migration-sense "applied"; Marker reads "migrated to"/"run"; tracker row added | D1 | PASS | `eca130276`; `rg -i "appl(ied\|ies\|ying)" docs/glossary.md` empty; Marker entry rewritten; tracker row added |
| AC-2 | `ControlClient.migrate` exists (no `migrationApply`); `ControlActionName`+`RunAction` carry `'migrate'`; cli-owned apply/migrationApply tokens gone | D2,D3 | PASS | `78576c44e`+`e98aade19`; cli/src apply-token grep empty; `migrate()` at client.ts:457; literals at types.ts:74 + run-migration.ts:29 |
| AC-3 | Files `run-migration.ts`+`db-run.ts`+`migrate.ts` exist; `apply.ts`+`db-apply.ts`+`migration-apply.ts` gone; all three carry strategy header docs | D4 | PASS | `6a7da65ae`; new files present + old gone; each carries command+strategy header doc |
| AC-4 | No behavioural diff: operation bodies unchanged except identifiers/imports | D2,D3,D4 | PASS | base-vs-final body diff per file: only identifier/comment renames + import paths; line-for-line parity, zero logic moved |

Status values: `PASS` / `FAIL` / `NOT VERIFIED — <reason>` / `ACCEPTED DEFERRAL — <link>` / `OUT OF SCOPE`.

## Subagent IDs

- **Implementer:** `a3d81e0dba4e5322c` (sonnet) — first spawned D1–D4 R1.
- **Reviewer:** `ad0cc9b433a8b0c57` (opus) — first spawned slice R1.

## Findings log

_(no findings yet)_

## Round notes

### Slice R1 — SATISFIED

**Scope:** D1–D4. Commits `eca130276..6a7da65ae` (`eca130276` glossary, `78576c44e` migrate, `e98aade19` apply→run, `6a7da65ae` file renames). 17 files.

**Tasks:** D1 clean (glossary Marker + tracker row). D2 clean (`migrate()` + `Migrate*` family + `'migrate'` literal). D3 clean (`runMigration`/`RunAction`/`executeRun`/`executeMigrate`/`RUN_SPAN_ID` + "Running migration plan…" label). D4 clean (3 `git mv` + strategy header docs).

**AC delta:** all four NOT VERIFIED → PASS. AC-1 `eca130276`. AC-2 `78576c44e`+`e98aade19`. AC-3 `6a7da65ae`. AC-4 confirmed by base-vs-final body diff.

**AC-4 behavioural invariance:** verified by diffing each renamed file's final body against its pre-rename body at base `c159cd423` (normalising the in-scope identifier renames). Every residual line is an identifier rename, comment-prose rewording, or import-path/import-order change — line-for-line parity, no statement added/removed/reordered. `db-run.ts` has exact 423=423 line parity post-header; `migrate.ts` deltas are solely the type renames + biome collapsing the now-shorter `buildNeverPlannedFailure` signature onto one line (the `Contract` import is retained, used at the `contract: Contract` field). `RUN_SPAN_ID`/`spanId` value stays the wire-stable `'apply'` (constant *name* renamed, value intentionally unchanged).

**Lockstep literals:** `'migrate'` agrees in `ControlActionName` (types.ts:74) and `RunAction` (run-migration.ts:29). `progressLabelForAction` switch is exhaustive (3 arms, no `default`, no stale `'migrationApply'`) — tsc-enforced. Both runtime-DATA asserts hand-updated (`apply.progress.test.ts:14`, `apply.test.ts:137,140`).

**Scope discipline:** deferred items untouched — migration-tools `applyOrder`/`SpaceApplyInput`/`concatenate…`/`compute…ApplyPath` (diff clean), `MigrationApplyStep` retained (types.ts:596), `mode:'plan'|'apply'` retained (db-run.ts), formatters `formatMigrationApply*` retained. No back-compat alias added. JSDoc at types.ts:899-903 now documents real `MigrateOptions` fields (stale originHash/destinationHash/pendingMigrations gone). Transient-ID scan on `+` diff: zero hits.

**MigrateRanEntry naming flag:** confirmed reads naturally — "migrate" namespace + "ran" (past tense of the `run` verb) is glossary-coherent. Result-object field names `applied`/`migrationsApplied` left as-is: renaming them is a public-shape change beyond naming-only scope (spec delegated only the *type* name). Accept.

**Findings:** none.

**For orchestrator:** Non-blocking, pre-existing (in base `c159cd423`, untouched here): `MigrateRanEntry` and the next interface each carry two stacked `/** */` JSDoc blocks (types.ts ~609-621, ~631-645). Out of this slice's naming-only scope — not filed. Worth a cleanup ticket if the team wants it tidied.

## Orchestrator notes

- **Decision (D1–D4 collapsed into one implementer delegation):** the four dispatches are tightly-coupled mechanical renames; ran them as one persistent-implementer delegation landing commit-per-dispatch with the grep+typecheck+cli-test gate after each. Per-commit gates all reported green.
- **Orchestrator DoD verification (pre-review):** 4 commits `eca130276` (glossary) / `78576c44e` (migrate rename) / `e98aade19` (apply→run) / `6a7da65ae` (file renames). cli/src grep for `migrationApply|applyMigration|ApplyAction|executeApply|APPLY_SPAN_ID|executeMigrationApply` → empty. `MigrationApplyStep` preserved (2 refs, types.ts). migration-tools deferred vocab untouched. Operation files renamed (run-migration.ts/db-run.ts/migrate.ts present; old gone).
- **origin/main advanced** to `b9c7119ae` (ADR 224, unrelated) after branching from `c159cd423`. Base is an ancestor of current main → GitHub three-dot diff is clean (17 files, no stray changes). No rebase required.
- Implementer's `MigrationApplyAppliedEntry` → **`MigrateRanEntry`** (free naming choice the spec delegated). Flagged to reviewer to confirm it reads naturally.
