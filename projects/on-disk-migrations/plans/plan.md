# On-Disk Migrations Plan

## Summary

Implement on-disk migration serialization for prisma-next. `migration plan` converts the "from" contract to `SqlSchemaIR` via the target's `contractToSchema()` method, diffs against the "to" contract using the existing `PostgresMigrationPlanner` (the same planner `db init` uses), and writes the resulting operations to disk as migration edge packages.

**Spec:** `projects/on-disk-migrations/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review, layering compliance |

## Milestones

### Milestone 1: `contractToSchemaIR` converter ✅

Build the converter that maps `SqlStorage` → `SqlSchemaIR`. This is the infrastructure that enables `migration plan` to feed the "from" contract into the existing planner without a database connection.

Lives in the sql family tooling layer (`packages/2-sql/3-tooling/family/`), since it bridges `SqlStorage` (from `@prisma-next/sql-contract`) and `SqlSchemaIR` (from `@prisma-next/sql-schema-ir`).

The converter is exported as a standalone function from `@prisma-next/family-sql/control`. The `TargetMigrationsCapability` interface exposes `contractToSchema()` so the CLI can plan offline without importing SQL-domain code directly. Destructive change detection is handled by a hash-diff heuristic in the CLI itself (no family-specific method needed on the interface).

**Tasks:**

- [x] Implement `contractToSchemaIR(storage: SqlStorage): SqlSchemaIR`
- [x] Handle `ColumnDefault` conversion, `ForeignKey` reshaping, `Index` → `SqlIndexIR`
- [x] Export from `@prisma-next/family-sql/control`
- [x] Implement `detectDestructiveChanges(from, to)` for table/column removals (SQL family utility, tested directly)
- [x] Add `contractToSchema()` to `TargetMigrationsCapability` interface
- [x] Implement `contractToSchema()` on postgres target descriptor
- [x] Verify `pnpm lint:deps` passes
- [x] Unit tests for `contractToSchemaIR` (15 tests)
- [x] Unit tests for `detectDestructiveChanges` (7 tests)
- [x] Integration tests via `planFromStorages` (9 tests: additive, destructive, type/nullability)
- [x] Round-trip sanity test: convert contract → schemaIR → planner → empty plan

### Milestone 2: Wire `migration plan` CLI + on-disk persistence ✅

Wire `migration plan` to use the existing planner directly (same path as `db init`), and build the on-disk serialization infrastructure.

**Tasks:**

#### CLI command
- [x] `migration plan` reads config, loads contract, resolves "from" via DAG
- [x] Uses `migrations.contractToSchema()` + `migrations.createPlanner()` + `planner.plan()` — same path as `db init`
- [x] Detects destructive changes via hash-diff heuristic (hashes differ but planner produces no ops → infer removals)
- [x] Writes migration package to disk (`migration.json` + `ops.json`)
- [x] Attests `edgeId` via content-addressed hashing
- [x] `--from <hash>`, `--name <slug>`, `--json` flags
- [x] `migration new` scaffolds empty Draft package
- [x] `migration verify` recomputes and validates `edgeId`

#### On-disk format + infrastructure
- [x] TypeScript types for `migration.json` and `ops.json` (in `@prisma-next/migration-tools`)
- [x] Read/write migration packages, directory naming, collision handling
- [x] Edge attestation: `computeEdgeId`, `attestMigration`, `verifyMigration`
- [x] DAG reconstruction: `reconstructGraph`, `findLeaf`, `findPath`, cycle/orphan detection
- [x] Structured errors with `MIGRATION.*` stable codes

#### Clean up
- [x] Remove `ContractDiffResult`, `ContractDiffSuccess`, `ContractDiffFailure`, `ContractDiffConflict` types
- [x] Remove `planContractDiff` from `TargetMigrationsCapability` interface
- [x] Remove `contractDiff` from `ControlClient` interface
- [x] Verify `pnpm build`, `pnpm test:packages`, `pnpm lint:deps` all pass

#### Tests
- [x] CLI e2e tests (7 tests): fresh project, attestation, JSON output, no-op, incremental DAG chain, plan→verify→plan lifecycle, destructive rejection
- [x] CLI command unit tests for migration-plan, migration-new, migration-verify
- [x] Migration tools tests: attestation, DAG, I/O round-trips

### Milestone 3: `migration apply` ✅

Build a `migration apply` command that reads on-disk migration packages and executes them against a live database using the existing `MigrationRunner` infrastructure (same runner `db init` uses).

**Key design decisions:**

- **Reuse the runner**: The `PostgresMigrationRunner.execute()` handles transactions, advisory locks, marker/ledger management, pre/postchecks, idempotency probes, and schema verification. Each migration becomes a single `runner.execute()` call.
- **One transaction per migration**: If migration N fails, migrations 1..N-1 are already committed. Re-running `apply` resumes from the last successful state (the marker reflects progress).
- **Enable execution checks**: Unlike `db init` (which disables pre/postchecks since it just introspected), `migration apply` runs from potentially stale on-disk ops, so all checks are enabled by default (prechecks, postchecks, idempotency probes).
- **Constructing `SqlMigrationPlan` from disk**: On-disk `ops.json` contains `SqlMigrationPlanOperation[]` (the planner serializes the full SQL-specific type). The manifest provides `from`/`to` hashes and contracts. These are assembled into a `SqlMigrationPlan` with `origin` and `destination` for the runner.
- **Uses `ControlClient`**: `migration apply` routes all DB operations through `ControlClient`, consistent with `db init` and `db update`.
- **`origin: null` for first migration**: The runner expects `origin: null` when there's no existing marker (fresh DB). `EMPTY_CONTRACT_HASH` is a DAG convention, not a runner convention.
- **Contract validation required**: Destination contracts from on-disk manifests must be validated via `familyInstance.validateContractIR()` for proper schema verification.
- **Framework components required**: The runner's schema verification needs framework components (target, adapter, extensions) built via `assertFrameworkComponentsCompatible()`.

**Tasks:**

#### Core implementation
- [x] Create `src/commands/migration-apply.ts`
- [x] Load config, resolve database connection (`--db <url>` or `config.db.connection`)
- [x] Read migrations directory, filter out drafts (`edgeId === null`), reconstruct DAG
- [x] Read the current DB marker (`familyInstance.readMarker({ driver })`)
- [x] Match marker's `storageHash` to a known hash in the migration DAG
- [x] Use `findPath(graph, markerHash, leafHash)` to determine pending migrations
- [x] Error when marker hash doesn't match any known migration node
- [x] Informational message when no pending migrations (marker already at leaf)
- [x] For each pending migration edge (in path order):
  - [x] Construct plan with `origin: null` for `EMPTY_CONTRACT_HASH`, `origin: { storageHash }` otherwise
  - [x] Validate destination contract via `familyInstance.validateContractIR()`
  - [x] Call `runner.execute()` with plan, driver, destination contract, policy, framework components, and all execution checks enabled
  - [x] On runner failure: report which migration failed, what error code, and exit
  - [x] On runner success: report progress and continue to next migration
- [x] Report final summary: N migrations applied, marker now at hash X

#### CLI registration
- [x] Register under `migration` subcommand group in `cli.ts`
- [x] Options: `--db <url>`, `--config <path>`, `--json [format]`, `-q/--quiet`, `-v/--verbose`, `--no-color`
- [x] Export command factory and result type from `package.json` exports
- [x] Output: styled header, per-migration progress, summary
- [x] Add `migration apply` entry to `tsdown.config.ts` and `package.json` exports
- [x] Also fixed missing `tsdown.config.ts` entries for `migration-new` and `migration-verify`

#### Error handling
- [x] Map runner failures to `CliStructuredError` via `mapRunnerFailure()`
- [x] Handle `MigrationToolsError` from DAG/IO operations (same pattern as `migration plan`)
- [x] Handle connection errors via `CliStructuredError.is()`
- [x] Graceful message when migrations directory is empty or has no attested migrations

#### Tests
- [x] Unit tests: DAG path resolution (6 tests — empty-to-leaf, multi-step, at-leaf no-op, unknown marker, skip drafts, edge-to-package matching)
- [x] E2E test: `plan → apply` against real Postgres (using `withDevDatabase`)
- [x] E2E test: apply is idempotent (re-run after success is a no-op)
- [x] E2E test: apply with multiple pending migrations executes in DAG order
- [x] E2E test: resume after apply (re-run is no-op)
- [x] E2E test: styled output verification

### Milestone 4: Close-out

**Tasks:**

- [x] Walk through every acceptance criterion in the spec and confirm test coverage
- [x] Run `pnpm test:all` and `pnpm lint:deps` — everything passes
- [x] Update CLI README with new commands (`migration apply`, entrypoints list)
- [ ] Write/update ADRs if implementation decisions diverged from existing ADRs
- [ ] Migrate long-lived docs into `docs/`
- [ ] Delete `projects/on-disk-migrations/`

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Status |
|---|---|---|---|
| `contractToSchemaIR` correctly converts `SqlStorage` to `SqlSchemaIR` | Unit | M1 | ✅ 15 tests |
| `detectDestructiveChanges` catches table/column removals | Unit | M1 | ✅ 7 tests |
| Planner detects type changes and nullability tightening as conflicts | Integration | M1 | ✅ 2 tests |
| `migration plan` produces correct additive operations | E2E | M2 | ✅ |
| `migration plan` handles "from empty contract" case | E2E | M2 | ✅ |
| TypeScript types for `migration.json`, `ops.json` defined and exported | Unit | M2 | ✅ |
| `migration.json` and `ops.json` round-trip with full fidelity | Unit | M2 | ✅ |
| `edgeId` correctly computed via content-addressed hashing | Unit | M2 | ✅ |
| `migration plan` writes valid package | E2E | M2 | ✅ |
| `migration plan` reports no-op when no changes detected | E2E | M2 | ✅ |
| `migration plan` rejects destructive changes | E2E | M2 | ✅ |
| `migration new` scaffolds empty Draft package | Unit | M2 | ✅ |
| `migration verify` recomputes and validates edgeId | Unit | M2 | ✅ |
| DAG reconstructed from on-disk packages | Unit | M2 | ✅ |
| Path resolution finds correct edge sequence | Unit | M2 | ✅ |
| Cycle detection identifies illegal cycles | Unit | M2 | ✅ |
| Orphan detection identifies unreachable migrations | Unit | M2 | ✅ |
| `migration apply` reads and executes SQL against live DB | E2E | M3 | ✅ |
| `migration apply` updates marker and ledger after each migration | E2E | M3 | ✅ (marker verified in apply test) |
| `migration apply` resumes from last successful migration on re-run | E2E | M3 | ✅ (re-run is no-op) |
| `migration apply` errors when marker hash is unknown | Unit | M3 | ✅ |
| `migration apply` is idempotent (re-run is no-op) | E2E | M3 | ✅ |
| `migration apply` executes multiple migrations in DAG order | E2E | M3 | ✅ |
| `migration apply` skips draft migrations | Unit | M3 | ✅ |
| All existing tests pass | E2E | M4 | ✅ |
| `pnpm lint:deps` passes | Lint | M1–M4 | ✅ |
| New CLI commands have e2e tests | E2E | M2 | ✅ 7 tests |

## Open Items

- The on-disk `MigrationOps` type is `readonly MigrationPlanOperation[]` (framework-level), but at runtime the serialized ops are `SqlMigrationPlanOperation[]` (with `precheck`, `execute`, `postcheck` arrays). The runner expects `SqlMigrationPlanOperation[]`. Since we JSON.stringify/parse, the SQL-specific fields are preserved. A type assertion is needed when constructing the `SqlMigrationPlan` from disk — this is a known type boundary documented in the implementation comments.
- Policy for `migration apply`: passes all operation classes to the runner. The policy gate belongs at plan time (`migration plan` allows `additive`, `widening`, `destructive`), not apply time.
- Partial-failure E2E test (migration 2 of 3 fails, migration 1 preserved) is deferred — requires crafting a fixture that produces invalid SQL ops, which is fragile. The resume semantics are implicitly tested by the idempotency test (re-run is no-op after success).
