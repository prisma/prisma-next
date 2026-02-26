# On-Disk Migrations Plan

## Summary

Implement on-disk migration serialization for prisma-next. `migration plan` converts the "from" contract to `SqlSchemaIR`, diffs against the "to" contract using the existing `PostgresMigrationPlanner`, and writes the resulting operations to disk as migration edge packages. The serialization layer (types, I/O, attestation, DAG) is already built. The remaining work is the `contractToSchemaIR` converter, rewiring `migration plan` to use it, cleaning up the unused contract-to-contract planner code, and building `migration apply`.

**Spec:** `projects/on-disk-migrations/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review, layering compliance |

## Milestones

### Milestone 1: `contractToSchemaIR` converter

Build the converter that maps `SqlStorage` → `SqlSchemaIR`. This is the new infrastructure that enables `migration plan` to feed the "from" contract into the existing planner without a database connection.

Lives in the sql family tooling layer (`packages/2-sql/3-tooling/family/`), since it bridges `SqlStorage` (from `@prisma-next/sql-contract`) and `SqlSchemaIR` (from `@prisma-next/sql-schema-ir`).

**Design note:** The existing planner resolves extension dependencies from framework components (via `databaseDependencies`), not from the `SqlSchemaIR.extensions` field. The schema IR's `extensions` field tells the planner which extensions are *already installed* so it can skip emitting `enableExtension` ops. For a synthesized schema IR from a "from" contract, `extensions` should be `[]` — the planner will correctly emit extension ops if the "to" contract needs them.

`SqlStorage.types` (storage type instances like pgvector) are codec-level metadata. They're not mapped into schema IR — the planner discovers type/extension needs from framework components, not from schema IR.

The converter is exported as a standalone function so it can be used elsewhere if needed, but the `TargetMigrationsCapability` method calls it internally so callers don't need to know about it.

**Tasks:**

- [ ] Implement `contractToSchemaIR(storage: SqlStorage): SqlSchemaIR` — map tables, columns (nativeType, nullable, default), PK, uniques, indexes, foreign keys; `extensions: []`; handle empty/null storage → empty schema IR
- [ ] Handle `ColumnDefault` conversion: `kind: 'literal'` → raw expression string, `kind: 'function'` → raw expression string
- [ ] Handle `ForeignKey` reshaping: `references.table` → `referencedTable`, `references.columns` → `referencedColumns`
- [ ] Handle `Index` → `SqlIndexIR` with `unique: false`
- [ ] Export from `@prisma-next/family-sql/control`
- [ ] Verify `pnpm lint:deps` passes
- [ ] Test: empty storage → empty schema IR (with `extensions: []`)
- [ ] Test: single table with columns → correct `SqlTableIR` with `SqlColumnIR` entries
- [ ] Test: columns with literal defaults → correct raw expression
- [ ] Test: columns with function defaults → correct raw expression
- [ ] Test: columns with no default → no `default` field in output
- [ ] Test: PK, uniques, indexes, foreign keys → correct schema IR shapes
- [ ] Test: `codecId`, `typeParams`, `typeRef` not present in output
- [ ] Test: round-trip sanity — convert contract to schemaIR, feed same contract + converted schemaIR to planner → empty plan (no ops)

### Milestone 2: Rewire `migration plan` + clean up

Rewire the `migration plan` CLI command to use `contractToSchemaIR` + the existing planner (instead of the contract-to-contract `planContractDiff`), and remove the now-unused contract-to-contract planner code.

**Tasks:**

#### Rewire `migration plan`

The `TargetMigrationsCapability` method accepts two contracts and handles the conversion internally — callers don't need to know about `contractToSchemaIR`. The converter is also exported standalone from `@prisma-next/family-sql/control` for other use cases.

- [ ] Update `TargetMigrationsCapability` interface: replace `planContractDiff` with a method that accepts a "from" contract + "to" contract, internally converts "from" to schemaIR via `contractToSchemaIR`, then calls the existing planner
- [ ] Implement in Postgres target descriptor: extract storage from "from" contract, call `contractToSchemaIR`, call existing `PostgresMigrationPlanner.plan({ contract: toContract, schema: fromSchemaIR, ... })`
- [ ] Update `ControlClient` interface and implementation: replace `contractDiff()` with the new method
- [ ] Update `executeMigrationPlanCommand` in `migration-plan.ts` to call the new control client method (keep DAG-based "from" resolution, keep `--from <hash>`)
- [ ] Update command output formatters if the result shape changed

#### Clean up contract-to-contract planner code

- [ ] Remove `packages/2-sql/3-tooling/family/src/core/migrations/contract-planner.ts`
- [ ] Remove `packages/2-sql/3-tooling/family/src/core/migrations/sql-emitter.ts`
- [ ] Remove `packages/2-sql/3-tooling/family/test/contract-planner.test.ts`
- [ ] Remove `packages/2-sql/3-tooling/family/test/test-emitter.ts`
- [ ] Remove `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-sql-emitter.ts`
- [ ] Remove `packages/3-targets/3-targets/postgres/test/migrations/postgres-sql-emitter.test.ts`
- [ ] Remove `ContractDiffResult`, `ContractDiffSuccess`, `ContractDiffFailure` types from `migrations.ts` (if no longer referenced)
- [ ] Update barrel exports in affected packages
- [ ] Verify `pnpm build`, `pnpm test:packages`, `pnpm lint:deps` all pass

#### Tests

- [ ] Test: `migration plan` happy path — reads "from" contract from DAG, converts to schemaIR, writes valid migration package with correct manifest and ops
- [ ] Test: `migration plan` no-op — "from" and "to" contracts are identical → no migration written
- [ ] Test: `migration plan` missing contract.json → ENOENT error
- [ ] Test: `migration plan` `--from <hash>` selects correct starting contract
- [ ] Test: new project flow (no existing migrations) — produces correct ops from empty schema
- [ ] Test: incremental change flow — plan migration A, plan migration B, verify B's `from` matches A's `to`

### Milestone 3: `migration apply` (limited)

Build a minimal `migration apply` command that reads on-disk migration packages and executes the SQL against a live database. The ops are already SQL — apply just reads from `ops.json` and executes.

**Tasks:**

- [ ] Create `src/commands/migration-apply.ts` with options: `--config <path>`, `--url <connection-string>`, `--json`, `-q`, `-v`
- [ ] Read migrations directory, reconstruct DAG, determine pending migrations (compare marker hash against migration `from`/`to` chain)
- [ ] Execute each pending migration's SQL from `ops.json` in a transaction
- [ ] Determine ledger strategy: update marker's `core_hash` to the migration's `to` hash after each successful migration
- [ ] Register under `migration` subcommand group
- [ ] Output formatters (TTY: progress per migration; JSON: structured result)
- [ ] Integration test: plan → apply against a real Postgres database, verify schema changes applied
- [ ] Integration test: apply is idempotent — running apply when all migrations are already applied is a no-op
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

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `contractToSchemaIR` correctly converts `SqlStorage` to `SqlSchemaIR` | Unit | M1 | Field mapping, edge cases, dropped fields |
| `migration plan` produces correct additive operations (from→schemaIR→plan) | Unit + E2E | M1, M2 | M1: round-trip sanity; M2: full CLI flow |
| `migration plan` handles "from empty contract" case | E2E | M2 | New project flow test |
| TypeScript types for `migration.json`, `ops.json` defined and exported | Unit | Done (M1 prev) | Round-trip serialization tests |
| `migration.json` and `ops.json` round-trip with full fidelity | Unit | Done (M1 prev) | Byte-level equality |
| `edgeId` correctly computed via content-addressed hashing | Unit | Done (M1 prev) | Compute, verify, tamper, re-verify |
| `migration plan` writes valid package | E2E | M2 | Full convert → plan → write flow |
| `migration plan` fails clearly when no changes detected | E2E | M2 | No-op test |
| `migration new` scaffolds empty Draft package | Unit | Done (M3 prev) | edgeId null, empty ops |
| `migration verify` recomputes and validates edgeId | Unit | Done (M3 prev) | Pass/fail/attest |
| `migration apply` reads and executes SQL against live DB | Integration | M3 | plan → apply → verify schema |
| `migration apply` updates migration ledger | Integration | M3 | edgeId + contract hash recorded |
| DAG reconstructed from on-disk packages | Unit | Done (M1 prev) | Linear, branching, empty |
| Path resolution finds correct edge sequence | Unit | Done (M1 prev) | Deterministic ordering |
| Cycle detection identifies illegal cycles | Unit | Done (M1 prev) | Reports cycles |
| Orphan detection identifies unreachable migrations | Unit | Done (M1 prev) | BFS from empty hash |
| All existing tests pass | E2E | M4 | `pnpm test:all` |
| `pnpm lint:deps` passes | Lint | M1, M2, M3, M4 | After each change |
| New CLI commands have e2e tests | E2E | M2, M3 | `migration plan`, `migration apply` |

## Resolved Questions

1. **`SqlStorage.types` and extensions in schema IR**: The existing planner resolves extension dependencies from framework components (`databaseDependencies`), not from `SqlSchemaIR.extensions`. The schema IR `extensions` field tells the planner what's *already installed*. For a synthesized schema IR, `extensions: []` is correct — the planner will emit extension ops if the "to" contract needs them. `SqlStorage.types` are not mapped to schema IR.

2. **`contractToSchemaIR` exposure**: The converter is exported standalone from `@prisma-next/family-sql/control` for reuse. The `TargetMigrationsCapability` method calls it internally, so callers (CLI, control client) don't need to know about the conversion.

3. **`MigrationOps` type breadth**: The serializer treats ops as mostly opaque — it reads and writes them from disk without inspecting their internal structure. The `MigrationOps` type (`readonly MigrationPlanOperation[]`) is the base interface; the actual JSON payload contains the full `SqlMigrationPlanOperation` shape with all SQL steps, and the serializer preserves it through `JSON.stringify`/`JSON.parse`.

## Open Items

None.
