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

### Milestone 3: `migration apply`

Build a `migration apply` command that reads on-disk migration packages and executes them against a live database using the existing `MigrationRunner` infrastructure (same runner `db init` uses).

**Key design decisions:**

- **Reuse the runner**: The `PostgresMigrationRunner.execute()` handles transactions, advisory locks, marker/ledger management, pre/postchecks, idempotency probes, and schema verification. Each migration becomes a single `runner.execute()` call.
- **One transaction per migration**: If migration N fails, migrations 1..N-1 are already committed. Re-running `apply` resumes from the last successful state (the marker reflects progress).
- **Enable execution checks**: Unlike `db init` (which disables pre/postchecks since it just introspected), `migration apply` runs from potentially stale on-disk ops, so all checks are enabled by default (prechecks, postchecks, idempotency probes).
- **Constructing `SqlMigrationPlan` from disk**: On-disk `ops.json` contains `SqlMigrationPlanOperation[]` (the planner serializes the full SQL-specific type). The manifest provides `from`/`to` hashes and contracts. These are assembled into a `SqlMigrationPlan` with `origin` and `destination` for the runner.
- **No `ControlClient`**: Unlike `db init`, `migration apply` doesn't need the full `ControlClient` lifecycle. It can create the runner directly from `config.target.migrations.createRunner()` and use a lightweight driver connection. However, following the `db init` pattern (using `ControlClient.connect()` for consistency) is acceptable.

**Tasks:**

#### Core implementation
- [ ] Create `src/commands/migration-apply.ts`
- [ ] Load config, resolve database connection (`--db <url>` or `config.db.connection`)
- [ ] Load contract file (the "to" contract — same as `migration plan`)
- [ ] Read migrations directory, filter out drafts (`edgeId === null`), reconstruct DAG
- [ ] Read the current DB marker (`familyInstance.readMarker({ driver })`)
- [ ] Match marker's `storageHash` to a known hash in the migration DAG
- [ ] Use `findPath(graph, markerHash, leafHash)` to determine pending migrations
- [ ] Error when marker hash doesn't match any known migration node
- [ ] Error (informational) when no pending migrations (marker already at leaf)
- [ ] For each pending migration edge (in path order):
  - [ ] Read the full `MigrationPackage` (manifest + ops) for that edge
  - [ ] Construct `SqlMigrationPlan` from manifest (`origin` = edge's `from`, `destination` = edge's `to`, `operations` = ops cast to `SqlMigrationPlanOperation[]`)
  - [ ] Call `runner.execute()` with the plan, driver, destination contract (from manifest's `toContract`), policy, and `executionChecks: { prechecks: true, postchecks: true, idempotencyChecks: true }`
  - [ ] On runner failure: report which migration failed, what error code, and exit (previously applied migrations are safe)
  - [ ] On runner success: report progress and continue to next migration
- [ ] Report final summary: N migrations applied, marker now at hash X

#### CLI registration
- [ ] Register under `migration` subcommand group in `cli.ts`
- [ ] Options: `--db <url>`, `--config <path>`, `--json [format]`, `-q/--quiet`, `-v/--verbose`, `--no-color`
- [ ] Export command factory and result type from `package.json` exports
- [ ] Output: styled header, per-migration progress, summary (matching `db init` style)
- [ ] Add `migration apply` entry to CLI exports in `package.json`

#### Error handling
- [ ] Map runner failures to `CliStructuredError` (reuse `mapDbInitFailure` patterns for `RUNNER_FAILED`, `MARKER_ORIGIN_MISMATCH`, etc.)
- [ ] Handle `MigrationToolsError` from DAG/IO operations (same pattern as `migration plan`)
- [ ] Handle connection errors via `CliStructuredError.is()` (same as `db init`)
- [ ] Graceful error message when migrations directory is empty or doesn't exist

#### Tests
- [ ] Unit test: command logic with mocked runner (pending migration identification, DAG path resolution)
- [ ] Unit test: error when marker hash is unknown
- [ ] Unit test: no-op when marker already at leaf
- [ ] E2E test: `plan → apply` against a real Postgres database (using `withDevDatabase`)
- [ ] E2E test: apply is idempotent (re-run after success is a no-op)
- [ ] E2E test: apply with multiple pending migrations executes in DAG order
- [ ] E2E test: partial failure (migration 2 of 3 fails) — migration 1 committed, re-run resumes from migration 2

### Milestone 4: Close-out

**Tasks:**

- [ ] Walk through every acceptance criterion in the spec and confirm test coverage
- [ ] Run `pnpm test:all` and `pnpm lint:deps` — everything passes
- [ ] Update CLI README with new commands, usage examples, and workflow documentation
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
| `migration apply` reads and executes SQL against live DB | E2E | M3 | Not started |
| `migration apply` updates marker and ledger after each migration | E2E | M3 | Not started |
| `migration apply` resumes from last successful migration on re-run | E2E | M3 | Not started |
| `migration apply` errors when marker hash is unknown | Unit | M3 | Not started |
| `migration apply` is idempotent (re-run is no-op) | E2E | M3 | Not started |
| `migration apply` executes multiple migrations in DAG order | E2E | M3 | Not started |
| `migration apply` partial failure: committed migrations preserved | E2E | M3 | Not started |
| All existing tests pass | E2E | M4 | ✅ |
| `pnpm lint:deps` passes | Lint | M1–M4 | ✅ |
| New CLI commands have e2e tests | E2E | M2 | ✅ 7 tests |

## Open Items

- M3 task spec: `projects/on-disk-migrations/specs/migration-apply.spec.md`
- The on-disk `MigrationOps` type is `readonly MigrationPlanOperation[]` (framework-level), but at runtime the serialized ops are `SqlMigrationPlanOperation[]` (with `precheck`, `execute`, `postcheck` arrays). The runner expects `SqlMigrationPlanOperation[]`. Since we JSON.stringify/parse, the SQL-specific fields are preserved. A type assertion is needed when constructing the `SqlMigrationPlan` from disk — document this as a known type boundary.
- Policy for `migration apply`: currently hardcoded to `additive` only (matches `migration plan`). If destructive migrations are supported in the future, the policy stored in `migration.json` hints should be respected.
