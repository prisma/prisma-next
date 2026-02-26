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

### Milestone 3: `migration apply` (not started, descoped from current PR)

Build a minimal `migration apply` command that reads on-disk migration packages and executes the SQL against a live database.

**Tasks:**

- [ ] Create `src/commands/migration-apply.ts`
- [ ] Read migrations directory, reconstruct DAG, determine pending migrations
- [ ] Execute each pending migration's SQL from `ops.json` in a transaction
- [ ] Update marker's `core_hash` to the migration's `to` hash after each successful migration
- [ ] Register under `migration` subcommand group
- [ ] Integration test: plan → apply against a real Postgres database
- [ ] Integration test: apply is idempotent
- [ ] Integration test: apply with multiple pending migrations executes them in DAG order

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
| `migration apply` reads and executes SQL against live DB | Integration | M3 | Not started |
| `migration apply` updates migration ledger | Integration | M3 | Not started |
| All existing tests pass | E2E | M4 | ✅ |
| `pnpm lint:deps` passes | Lint | M1–M4 | ✅ |
| New CLI commands have e2e tests | E2E | M2 | ✅ 7 tests |

## Open Items

None for M1–M2. M3 (`migration apply`) is descoped from the current PR and will be a follow-up.
