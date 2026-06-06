# Slice: reconcile the control-api surface with the CLI command surface

_Parent project `projects/migration-graph-rendering/`. Outcome: the control-api surface the read-command family (`migration status` / `log`) is growing against speaks the project's ubiquitous language — `migrate` for advancing the database, `run` for executing a migration's ops — with no method or type encoding the retired "apply migrations" phrasing._

## At a glance

The CLI control-api surface (`ControlClient` methods + `cli/src/control-api/operations/*`) has drifted from both the command surface and the glossary: `client.migrationApply(...)` is the apply entry point, but the command that drives it is `migrate`, and **"apply (a) migration" is not in our ubiquitous language** — the glossary anchors `migration` as a noun, `migrate` as the verb for advancing a live DB, and `run` as the control-plane act of executing a migration's ops. This slice (1) updates the glossary to retire "applied", (2) renames the public method `migrationApply` → `migrate` (+ its `Migrate*` types and `'migrate'` action literal), and (3) purges the cli-local `apply` vocabulary to `run`, renaming + documenting the three operation files. Naming/structure only — **no behavioural change** to apply/plan/verify.

## Chosen design

The glossary's two-level vocabulary is the spine of the rename:

| Concept | Ubiquitous-language verb | Where it lands |
| --- | --- | --- |
| Advancing a live DB along the migration graph | **`migrate`** | the `migrate` command → `ControlClient.migrate()` (public surface) |
| Executing a migration's ops via the runner | **`run`** | the cli-local shared primitive `runMigration` and the init/update/migrate operation files |

### 1. Glossary — retire "applied"

`docs/glossary.md:202` (Marker entry) is the only line carrying the word. Rewrite both instances:
- "tracks which contract is currently **applied**" → "tracks which contract the database is currently **migrated to**" (the marker's state is "where the DB sits in the graph").
- "if a migration was **applied** but the application wasn't redeployed" → "if a migration was **run** but the application wasn't redeployed".

Add a row to the Terminology Alignment Tracker table (`~line 307`):

| User-facing term | Current internal term | Scope | Status |
| --- | --- | --- | --- |
| `migrate` (advance DB) / `run` (execute a migration) | `apply` (verb) / `migrationApply` | Control-api method + types, internal naming, docs | **In progress** |

### 2. Public surface → `migrate`

| Surface (exported / reachable) | Before | After |
| --- | --- | --- |
| `ControlClient` method | `migrationApply(options)` | `migrate(options)` |
| Option/result types | `MigrationApply{Options,Result,Success,Failure,FailureCode,PathDecision,AppliedEntry}` | `Migrate{Options,Result,Success,Failure,FailureCode,PathDecision,RanEntry}` (impl picks the natural suffix for the last two; `…AppliedEntry` → a `run`/`migrate` form) |
| Progress union literal | `'migrationApply'` in `ControlActionName` (exported) | `'migrate'` |

`migrate` is the glossary verb **and** the command name — perfect 1:1 traceability (command `migrate` → `client.migrate()`), which is the ticket's core goal. (Earlier `applyMigrations` is rejected outright: "apply migrations" is off-language.)

### 3. Cli-local `apply` → `run`

All of these are defined and consumed **entirely within `cli/src/control-api/`** (investigation: zero references outside cli + migration-tools; the migration-tools half is deferred — see Scope/Out):

| Before | After | File |
| --- | --- | --- |
| `applyMigration` (shared runner primitive) | `runMigration` | `apply.ts` → `run-migration.ts` |
| `ApplyAction = 'dbInit'\|'dbUpdate'\|'migrationApply'` | `RunAction = 'dbInit'\|'dbUpdate'\|'migrate'` | same file |
| `ApplyMigrationInputs` / `…Value` / `…Result` | `RunMigrationInputs` / `…Value` / `…Result` | same file |
| `ApplyRunnerFailure` | `RunnerFailure` | same file |
| `APPLY_SPAN_ID` / `'Applying migration plan…'` label | `RUN_SPAN_ID` / `'Running migration plan…'` | same file |
| `executeApply` (backs `db init` + `db update`) | `executeRun` | `db-apply.ts` → `db-run.ts` |
| `executeMigrationApply` / `ExecuteMigrationApplyOptions` (backs `migrate`) | `executeMigrate` / `ExecuteMigrateOptions` | `migration-apply.ts` → `migrate.ts` |

Operation-file structure stays **split** (the synth-vs-replay heads are load-bearingly disjoint; merging was rejected in the prior design pass). Each file gains a header doc naming the command(s) it backs and its strategy:
- `run-migration.ts` — shared runner tail; backs no command directly.
- `db-run.ts` — backs `db init` / `db update`; strategy = introspect → `planMigration`, synth-for-app + graph-walk-extensions.
- `migrate.ts` — backs `migrate`; strategy = graph-walk-all-members, replay-only.

### 4. Lockstep literal sites (a method find-replace will NOT catch these)

- `ControlActionName` member — `types.ts:74`
- `RunAction` member + `progressLabelForAction` switch arm — `apply.ts:24,258` (no `default` ⇒ `tsc` exhaustiveness catches a stale arm)
- `connectWithProgress(..., 'migrationApply', ...)` — `client.ts:462` (typed ⇒ `tsc` catches)
- `action: 'migrationApply'` passed to the primitive — `migration-apply.ts:289`
- **Runtime-data assertions (`tsc` does NOT catch — hand-edit):** `test/control-api/apply.progress.test.ts:13-14`, `test/control-api/apply.test.ts:136-140`

### 5. Doc/comment fixes carried along

Stale JSDoc `types.ts:899-902` (documents `originHash`/`destinationHash`/`pendingMigrations` — none exist on the options type; rewrite to the real fields); `README.md:1423` + `:1436`; postgres facade comment `packages/3-extensions/postgres/src/exports/control.ts:5`; comment at `migration/src/aggregate/planner-types.ts:134`.

## Coherence rationale

One theme: bring the control-api migrate path and the glossary into agreement on `migrate`/`run`, eliminating "apply migrations." Every diff hunk is a glossary sentence, an identifier rename, a `git mv`, or a header comment — one concept moving, with `tsc` + two named runtime tests as the safety net. A reviewer holds it in one sitting.

## Scope

**In:** `docs/glossary.md` (line 202 + tracker row); the exported `migrate` method + `Migrate*` types + `'migrate'` literal; the cli-local `apply`→`run` purge (identifiers above) + 3 file renames + header docs; the `migrate.ts` call site in `commands/migrate.ts`; affected cli tests; the four doc/comment fixes.

**Out (deliberately — keeps the slice in one package, and respects "ask first" surfaces):**
- **`migration-tools` `apply` sequencing vocabulary** — `applyOrder` (planner-types), `SpaceApplyInput`, `concatenateSpaceApplyInputs`, `computeExtensionSpaceApplyPath`/`ExtensionSpaceApplyPathOutcome`. A second package with its own planner tests, and "apply-*order*" is sequencing language a half-step off the verb. Residual: cli's `runMigration` will still consume an `applyOrder` field / `SpaceApplyInput` from migration-tools. **Flagged as the follow-up** to finish the glossary-tracker row.
- **`MigrationApplyStep`** — its JSDoc says the name is deliberately back-compat-kept and ADR 208 references it; renaming ripples into an ADR (ask-first surface). Defer with the migration-tools follow-up.
- **`mode: 'plan' | 'apply'`** — a distinct plan-vs-execute concept ("apply mode"), not "apply a migration". Untouched.
- Behavioural changes to apply/plan/verify (`executeRun`/`executeMigrate`/`runMigration` bodies unchanged except identifiers).
- Formatters `formatMigrationApplyOutput` / `formatMigrationApplyCommandOutput` (presentation; the former formats `db init`/`db update` output).
- The four integration journey-suite local `migrationApply()` helpers (owned by `projects/migration-domain-model` M2).
- Re-exporting the `Migrate*` option/result types from `src/exports/control-api.ts` (pre-existing gap; out of naming-only scope).
- Any deprecated alias / backwards-compat export (repo policy: clean break).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| Two tests assert `'migrationApply'` as runtime string data | Must hand-edit | `tsc` can't catch a bare-string assertion: `apply.progress.test.ts:13-14`, `apply.test.ts:136-140`. |
| `applyOrder` / `SpaceApplyInput` from migration-tools remain after the cli purge | Expected residual | Those are another package's API names; the DoD grep targets cli-owned `apply`/`migrationApply` tokens, not migration-tools imports. Finishing them is the deferred follow-up. |
| Journey-suite `migrationApply()` helpers collide with this rename | Do **not** touch | Local CLI-shelling helpers, not the control-api method; owned by another in-flight project. |
| `MigrationApplyStep` referenced by ADR 208 | Keep + defer | Renaming drifts an ADR (ask-first). |

## Slice-specific done conditions

- [ ] `docs/glossary.md` contains no "applied"/"applies"/"applying" referring to migrations; the Marker entry reads "migrated to"/"run"; the tracker table has the `apply → migrate/run` row.
- [ ] `rg "migrationApply|applyMigration|ApplyAction|executeApply|ApplyRunnerFailure|ApplyMigration" packages/1-framework/3-tooling/cli/src` returns empty (cli-owned apply/migrationApply tokens gone). `ControlClient` exposes `migrate`; `ControlActionName` + `RunAction` carry `'migrate'`.
- [ ] Files `run-migration.ts` + `db-run.ts` + `migrate.ts` exist; `apply.ts` + `db-apply.ts` + `migration-apply.ts` are gone; all three carry a header doc naming command + strategy.
- [ ] No behavioural diff: operation bodies unchanged except identifiers (reviewer confirms from the diff).

## Open Questions

1. Include the `migration-tools` `apply`-sequencing rename (`applyOrder`→`runOrder`, `SpaceApplyInput`→`SpaceRunInput`, …) in this slice, or ship it as the follow-up that closes the tracker row? Working position: **follow-up** — keeps this slice one-package and cleanly reviewable; the tracker row is marked "In progress" to record the remainder.
2. Rename `MigrationApplyStep` + update ADR 208 now, or with the follow-up? Working position: **follow-up** (ADR edits are ask-first).
3. Should the `Migrate*` option/result types be re-exported from `control-api.ts` so a programmatic `client.migrate(...)` consumer can name them? Working position: **no — out of scope** (public-surface addition, not a rename); flag as a possible follow-up.

## References

- Parent project: `projects/migration-graph-rendering/spec.md`
- Linear issue: [TML-2780](https://linear.app/prisma-company/issue/TML-2780/reconcile-the-control-api-surface-with-the-cli-command-surface) — branch `tml-2780-reconcile-the-control-api-surface-with-the-cli-command`
- Glossary: `docs/glossary.md` §"Migration & Database Lifecycle" (`migrate` verb / `migration` noun) + Terminology Alignment Tracker
- Repo policy: CLAUDE.md "Don't add backwards-compat exports unless asked"; `.agents/rules/no-backward-compatibility.mdc`
