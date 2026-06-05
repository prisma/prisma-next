## Dispatch plan

_Slice: `reconcile-control-api-surface`. Four sequential dispatches, one PR (commit-per-dispatch). Joints: language first (glossary), then the public verb (`migrate`), then the internal verb (`run`), then the file moves. Each commit is a self-contained reviewable unit; the split keeps "language vs public-API vs internal-rename vs file-move" legible in the diff._

### Dispatch 1: Retire "applied" from the glossary

- **Outcome:** `docs/glossary.md` carries no "applied"/"applies"/"applying" referring to migrations. The Marker entry (line 202) reads "currently **migrated to**" and "a migration was **run**"; the Terminology Alignment Tracker table (~line 307) has a new row `apply (verb) / migrationApply → migrate (advance DB) / run (execute a migration)`, status **In progress**.
- **Builds on:** The spec's chosen design (the `migrate`/`run` two-level vocabulary).
- **Hands to:** A glossary that mandates the vocabulary the next three dispatches implement — the language is now the source of truth for the rename.
- **Focus:** `docs/glossary.md` only. **Out:** any code change; other docs' incidental "apply" usage. **Gate:** `rg -i "appl(ied|ies|ying)" docs/glossary.md` returns only non-migration hits (or empty); the tracker row exists.

### Dispatch 2: Rename the public method surface to `migrate`

- **Outcome:** `ControlClient` exposes `migrate(options)` (no `migrationApply`); the `MigrationApply*` option/result type family → `Migrate*`; the exported action literal is `'migrate'` in `ControlActionName`; every caller, test, README line, and cross-package doc comment that names the method or the literal is updated. `tsc` + the cli package suite are green.
- **Builds on:** Dispatch 1's glossary vocabulary.
- **Hands to:** A green tree where the public control-api verb is `migrate` end-to-end; the only remaining `apply`-vocab tokens are the cli-**internal** `applyMigration`/`ApplyAction`/`executeApply`/`executeMigrationApply` + the three filenames — all deferred to D3/D4.
- **Focus:**
  - `types.ts:74` (`ControlActionName` member `'migrationApply'`→`'migrate'`), `types.ts:905` (interface decl), `client.ts:460` (impl) + `client.ts:462` (`connectWithProgress` arg).
  - Type family `MigrationApply{Options,Result,Success,Failure,FailureCode,PathDecision,AppliedEntry}` → `Migrate{Options,Result,Success,Failure,FailureCode,PathDecision,RanEntry}` (impl picks the natural form for `…AppliedEntry`) across `types.ts`, `client.ts`, `migration-apply.ts`, `commands/migrate.ts`, `utils/cli-errors.ts`, `test/cli-errors.test.ts`. **Keep `MigrationApplyStep`** (deferred).
  - Call site `commands/migrate.ts:315` (+ comment `:139`); the `action: 'migrationApply'`→`'migrate'` literal at `migration-apply.ts:289`; the `'migrationApply'` arm in `progressLabelForAction` (`apply.ts:258`) and the `ApplyAction` member (`apply.ts:24`) — these flip to `'migrate'` now even though the *type* `ApplyAction` is renamed in D3 (the literal is shared with the exported `ControlActionName`).
  - Tests incl. the two runtime-literal asserts (`tsc` won't flag): `apply.progress.test.ts:13-14`, `apply.test.ts:136-140`; mock name in `migrate-to-contract.test.ts`.
  - Docs: stale JSDoc `types.ts:899-902`; `README.md:1423`+`:1436`; postgres facade comment `control.ts:5`; `planner-types.ts:134` comment.
  - **Out:** internal `apply`→`run` identifier renames + file moves (D3/D4); the spec's `Out` items.
  - **Gate:** `pnpm typecheck`; `pnpm test:packages -- @prisma-next/cli` green; `rg "\bmigrationApply\b|MigrationApply(Options|Result|Success|Failure|FailureCode|PathDecision|AppliedEntry)" packages/1-framework/3-tooling/cli/src` empty.

### Dispatch 3: Purge the cli-local `apply` vocabulary to `run`

- **Outcome:** The internal shared primitive and its types speak `run`: `applyMigration`→`runMigration`, `ApplyAction`→`RunAction`, `ApplyMigrationInputs`/`…Value`/`…Result`→`RunMigration*`, `ApplyRunnerFailure`→`RunnerFailure`, `APPLY_SPAN_ID`→`RUN_SPAN_ID`, the `'Applying migration plan…'` progress label→`'Running migration plan…'`; `executeApply`→`executeRun`; `executeMigrationApply`/`ExecuteMigrationApplyOptions`→`executeMigrate`/`ExecuteMigrateOptions`. **No file moves yet** (filenames still `apply.ts`/`db-apply.ts`/`migration-apply.ts`). `tsc` + cli suite green.
- **Builds on:** Dispatch 2's hand-off — the public verb is already `migrate`, so the only `apply` tokens left are these internal identifiers.
- **Hands to:** A green tree where every cli-owned identifier speaks `run`/`migrate`; the only remaining `apply` tokens are the three filenames (D4) and the migration-tools imports (`applyOrder`/`SpaceApplyInput`, deferred follow-up).
- **Focus:** identifier renames within `control-api/operations/{apply,db-apply,migration-apply}.ts`, `client.ts`, and their tests; update the `RunAction` switch exhaustiveness. **Out:** file renames (D4); migration-tools' `applyOrder`/`SpaceApplyInput`/`concatenate…`/`compute…ApplyPath`; `mode:'apply'`; behavioural change. **Gate:** `pnpm typecheck`; cli suite green; `rg "applyMigration|ApplyAction|executeApply|ApplyRunnerFailure|ApplyMigration|APPLY_SPAN_ID" packages/1-framework/3-tooling/cli/src` empty.

### Dispatch 4: Rename the operation files + add strategy header docs

- **Outcome:** `git mv apply.ts run-migration.ts`, `db-apply.ts db-run.ts`, `migration-apply.ts migrate.ts`; all imports updated; each of the three files carries a header doc stating the command(s) it backs and its strategy. `tsc` + cli suite green; no behavioural diff.
- **Builds on:** Dispatch 3's hand-off — identifiers already speak `run`/`migrate`, so this dispatch only moves files and writes docs.
- **Hands to:** The slice-DoD: control-api operation files map onto the commands they back, fully documented, zero cli-owned `apply` tokens, glossary aligned. Ready for PR.
- **Focus:** the three `git mv`s; update importers (`client.ts` import of `./operations/migration-apply`→`./operations/migrate`, the `./apply`→`./run-migration` self-imports in `db-run.ts`/`migrate.ts` and tests under `test/control-api/`); add header docs to `run-migration.ts` / `db-run.ts` / `migrate.ts` (per spec §3). **Out:** any identifier change beyond import paths; behavioural change. **Gate:** `pnpm typecheck`; cli suite green; `test -f .../operations/run-migration.ts && test -f .../operations/db-run.ts && test -f .../operations/migrate.ts && ! test -e .../operations/apply.ts && ! test -e .../operations/db-apply.ts && ! test -e .../operations/migration-apply.ts`; `rg "migrationApply|applyMigration|ApplyAction|executeApply" packages/1-framework/3-tooling/cli/src` empty; reviewer confirms bodies unchanged except identifiers/imports.

_Each dispatch passes dispatch-INVEST: D1 is a contained doc edit; D2/D3 are mechanical "fan-out" renames with binary grep + typecheck + test gates and named runtime-literal catches; D4 is file-move + import fix-up + doc headers. All are Small (each fits one executor session, references scoped to the named files), Estimable (binary gates), Independent given the D1→D2→D3→D4 hand-offs. No behavioural surface moves in any. Total 4 ≤ 10. Ships as one PR, four commits._
