# Branch 5 Plan — CLI Command & E2E Wiring (`prisma-next db init`)

## Goal (Branch 5)

Implement the **CLI command** `prisma-next db init` and its **E2E test harness** (tasks **3.1–3.5** in `tasks.md`):

- Command factory: `createDbInitCommand()`
- Register in CLI command tree (`prisma-next db init`)
- Implement human + JSON output (`--plan`, `--json`)
- Add E2E tests covering supported DB states

This branch is explicitly about **CLI orchestration + reporting**. It must not re-implement planner/runner logic.

## Current State (What Exists Today)

- **No** `db init` command exists in `@prisma-next/cli` yet.
- CLI already has `db verify`, `db schema-verify`, `db sign`, `db introspect`, and `contract emit`.
- SQL Postgres planner currently supports **empty databases only** (fails if any tables exist).
- Postgres runner exists and already enforces the postcondition via:
  - `family.introspect()` → `verifySqlSchema()` → commit/rollback.

## Constraints / Standards

- **CLI patterns**:
  - Use `setCommandDescriptions()`.
  - Wrap core logic in `performAction()` and handle with `handleResult()`.
  - Commands call `process.exit(exitCode)` (no throwing from command action).
- **No target branches**: CLI must not special-case `targetId`.
- **Framework domain imports**: the CLI package should stay **family-agnostic** (avoid importing SQL-family-only types in command implementation).
- **Testing**:
  - TDD for new behavior.
  - E2E tests must use the existing CLI fixture app pattern and `createDevDatabase()` via `withDevDatabase()` / `withClient()`.
  - Respect dev DB single-connection limitation: do not hold a `withClient` connection while running CLI commands that also connect.
  - Pglite does **not** support Postgres extensions; branch-5 tests should avoid extension-dependent schemas.

## Implementation Plan

### 3.1 Add command factory

- Add `packages/1-framework/3-tooling/cli/src/commands/db-init.ts`
  - Export `createDbInitCommand(): Command`.
  - Add command options:
    - `--db <url>`
    - `--config <path>`
    - `--plan` (plan-only / dry run)
    - `--json [format]` (object/ndjson parity with other commands; start with object)
    - keep global flags consistent (`--quiet`, `--verbose`, `--trace`, `--timestamps`, `--color/--no-color`)

### 3.2 Apply CLI style + error patterns

- `setCommandDescriptions()`:
  - Short: “Bootstrap a database to match the current contract and write the contract marker.”
  - Long: explain additive-only semantics, empty-db support (for now), and idempotence.
- Use `performAction()` / `handleResult()` / `process.exit()`.
- Add new structured error factory for planning failure (recommended):
  - `errorDbInitPlanningFailed({ conflicts })` in `@prisma-next/core-control-plane/errors`
  - This avoids overloading `errorRuntime()` with unstructured strings and keeps JSON output predictable.

### 3.3 Orchestration logic (family-agnostic)

Inside the command action:

1. Load config (`loadConfig(options.config)`).
2. Resolve contract paths:
   - Use `config.contract.output` if present, else default `src/prisma/contract.json` (match `db schema-verify`).
3. Load `contract.json` from disk and parse.
4. Resolve DB URL:
   - `--db` overrides `config.db.url`
   - if missing → `errorDatabaseUrlRequired()`
5. Require driver (`config.driver`) → `errorDriverRequired()`
6. Create driver instance via descriptor.
7. Create family instance via `config.family.create({ target, adapter, driver: driverDescriptor, extensions })`.
8. Validate contract via `familyInstance.validateContractIR(contractJson)` (validated IR).
9. Obtain a planner/runner from the configured target descriptor.
   - Since CLI must remain family-agnostic, do this via **runtime capability detection** (duck-typing):
     - require `typeof config.target.createPlanner === 'function'`
     - require `typeof config.target.createRunner === 'function'`
   - If missing, throw structured CLI error indicating target lacks migration support (new error factory).
10. Introspect live schema into schema IR:
   - call `familyInstance.introspect({ driver, contractIR })`
11. Call planner:
   - `planner.plan({ contract: contractIR, schema: schemaIR, policy: { allowedOperationClasses: ['additive'] } })`
   - Handle result:
     - `{ kind: 'failure', conflicts }` → throw structured planning error (include conflicts in `meta`)
     - `{ kind: 'success', plan }`:
       - if `--plan`: format and return plan result (no runner)
       - else: execute runner:
         - `runner.execute({ plan, driver, destinationContract: contractIR, policy, callbacks })`
         - map success/failure to CLI output and exit codes

Notes:

- `--plan` mode is read-only (no marker/ledger writes).
- For apply mode, wire runner callbacks to log `creating table...`-style output.

### 3.4 Output formatting

#### Human output

- Header: use `formatStyledHeader()` like existing db commands.
- In `--plan` mode:
  - Render a tree-like summary of plan operations.
  - For v1 (empty-db only), grouping by `operation.target.details` (schema/objectType/name) is sufficient.
- In apply mode:
  - Show per-operation execution logs using runner callbacks.
  - Print final summary: operations planned/executed + marker/ledger written.

#### JSON output (`--json`)

Return a single JSON object on stdout in object mode (match other CLI commands):

- `ok: true/false`
- `mode: 'plan' | 'apply'`
- `plan` (serialized `MigrationPlan` on success)
- `execution` (only in apply mode): `operationsPlanned`, `operationsExecuted`
- `conflicts` (planning failure): array of conflicts
- `marker` / `ledger`:
  - If we want deterministic assertions, query `prisma_contract.marker` and last ledger row after apply and embed key fields (coreHash/profileHash, destination hash, operations count).
  - Keep this generic to “SQL marker schema”, not “Postgres”.

### 3.5 CLI tests (E2E)

Add `test/integration/test/cli.db-init.e2e.test.ts` following existing patterns in:
- `test/integration/test/cli.db-schema-verify.e2e.test.ts`
- `test/integration/test/cli.db-sign.e2e.test.ts`
- `test/integration/test/utils/cli-test-helpers.ts`

#### Fixture wiring

Add fixture subdir:

- `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/db-init/`
  - `contract.ts`
  - `prisma-next.config.with-db.ts` (use `{{DB_URL}}` placeholder)
  - optionally additional config variants (missing driver, missing db) for error-path tests

Tests use `withTempDir` + `setupTestDirectoryFromFixtures(createTempDir, 'db-init', ...)`.

#### Scenarios

Because Postgres planner is currently **empty-db only**, Branch 5 should include:

- **Empty DB**
  - `db init --plan --json`: emits plan, does not write marker
  - `db init --json`: applies plan, writes marker + ledger
  - assert:
    - table exists
    - marker row exists (hashes match destination contract)
    - ledger row exists (destination hash, operations present)

- **Non-empty DB**
  - Create any table before running `db init`
  - Expect planning failure with conflicts (currently `unsupportedOperation`)
  - Assert marker/ledger not written

Follow-ups (not in Branch 5 unless planner is expanded in the same branch):

- Subset DB (missing pieces planned)
- Superset DB (no-op plan)
- Conflicting DB (structured failure)

If these scenarios are required for Branch 5, we should first implement planner support (see tasks 8.1); otherwise, treat them as the next branch after planner enhancements.

## Commit-by-Commit Execution Plan (TDD + clean history)

1. Add failing E2E test skeleton for `db init` command wiring (command not found yet).
2. Implement `createDbInitCommand()` and register it in `src/cli.ts` (minimal behavior).
3. Add plan mode (`--plan`) output + tests.
4. Add apply mode calling runner + tests (marker/ledger assertions).
5. Add failure mapping for non-empty DB (planner failure) + tests.
6. Add JSON output envelope + snapshot/object assertions.
7. Update CLI exports (`tsup.config.ts`, `package.json`) + help snapshot if needed.


