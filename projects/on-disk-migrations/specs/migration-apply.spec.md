# Task Spec: `migration apply`

**Project:** On-Disk Migrations
**Milestone:** M3
**Parent spec:** `projects/on-disk-migrations/spec.md` (FR-10)

## Objective

Implement `prisma-next migration apply` — a CLI command that reads on-disk migration packages and executes them sequentially against a live Postgres database using the existing `MigrationRunner`.

## Scope

### In scope

- Read attested migration packages from the migrations directory
- Determine pending migrations by comparing the DB marker against the migration DAG
- Execute each pending migration via `runner.execute()` (one transaction per migration)
- Enable all execution checks (prechecks, postchecks, idempotency probes)
- Report per-migration progress and final summary
- Graceful error reporting on failure (which migration failed, why, what to do)
- Resume from last successful migration on re-run

### Out of scope

- Dry-run / plan mode for apply (show what would be applied without executing)
- Rollback support
- Apply to a specific target hash (always applies all pending to reach the DAG leaf)
- Partial apply (apply N of M pending migrations)
- Shadow database / dev database workflows
- Destructive operation support (policy is additive-only, matching `migration plan`)

## Architecture

### Execution flow

```
CLI flags → load config → load contract → read migrations dir
  → filter drafts → reconstruct DAG → find leaf
  → connect to DB → read marker → find pending path
  → for each pending migration:
      read ops.json → construct SqlMigrationPlan → runner.execute()
  → report summary → close connection
```

### Key infrastructure reuse

| Component | Source | Role in `apply` |
|---|---|---|
| `MigrationRunner` | `config.target.migrations.createRunner()` | Executes each migration within a transaction |
| `readMigrationsDir` | `@prisma-next/migration-tools/io` | Reads on-disk packages |
| `reconstructGraph`, `findLeaf`, `findPath` | `@prisma-next/migration-tools/dag` | Determines pending migrations |
| `ControlClient` | `@prisma-next/cli/control-api/client` | Manages DB connection lifecycle |
| `familyInstance.readMarker()` | Family instance | Reads current DB state |

### Type boundary: `MigrationOps` → `SqlMigrationPlanOperation[]`

The `MigrationOps` type is `readonly MigrationPlanOperation[]` (framework-level base type). At runtime, `ops.json` contains serialized `SqlMigrationPlanOperation[]` objects (with `precheck`, `execute`, `postcheck` arrays) because `migration plan` serializes the full planner output. When constructing the `SqlMigrationPlan` for the runner, we cast `ops` to `SqlMigrationPlanOperation[]`. This is safe because:

1. The serialization format preserves all fields (JSON round-trip)
2. The runner validates operation structure at execution time
3. The type mismatch is a consequence of the framework/family type layering, not a data issue

### Error scenarios

| Scenario | Behavior |
|---|---|
| No migrations directory | Informational "no migrations found" |
| Marker hash not in DAG | Error with fix suggestion |
| No pending migrations | Informational "already up to date" |
| Runner precheck fails | Rollback current migration, report error, exit |
| Runner execution fails | Rollback current migration, report error, exit |
| Runner schema verify fails | Rollback current migration, report error, exit |
| Connection failure | Error before any migration attempt |
| Draft migrations in directory | Filtered out (same as `migration plan`) |

### Transaction semantics

Each migration is an independent `runner.execute()` call. The runner internally:
1. `BEGIN` transaction
2. Acquire advisory lock
3. Ensure control tables
4. Validate marker compatibility
5. Execute operations (precheck → execute → postcheck per operation)
6. Verify schema against destination contract
7. Update marker and ledger
8. `COMMIT`

If any step fails, the runner rolls back the current transaction. Previously committed migrations are unaffected.

## Acceptance criteria

- [ ] `migration apply` reads on-disk migrations and executes SQL against a live database
- [ ] `migration apply` updates the marker and ledger after each successful migration
- [ ] `migration apply` resumes from last successful migration on re-run after failure
- [ ] `migration apply` errors when DB marker doesn't match any known migration hash
- [ ] `migration apply` reports "already up to date" when no pending migrations exist
- [ ] `migration apply` executes multiple migrations in correct DAG order
- [ ] `migration apply` enables execution checks (prechecks, postchecks, idempotency)
- [ ] `migration apply` skips draft migrations (edgeId === null)
