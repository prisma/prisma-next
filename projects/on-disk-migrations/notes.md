# On-Disk Migrations — Notes

## Why `contractToSchema` returns `unknown`

`TargetMigrationsCapability.contractToSchema()` returns `unknown`, and `MigrationPlanner.plan()` accepts `schema: unknown` and `contract: unknown`. This looks like a gap but is intentional.

**Root cause: layering.** These interfaces live in the framework core (`@prisma-next/core-control-plane`), which is family-agnostic. The framework layer cannot reference family-specific types like `SqlSchemaIR` or `SqlStorage` — those belong to the SQL family (`@prisma-next/family-sql`).

**How it works in practice:**

- The postgres target's `contractToSchema()` implementation calls `contractToSchemaIR(storage: SqlStorage): SqlSchemaIR` — fully typed within the SQL family boundary.
- The CLI and `ControlClient` never inspect the schema IR. They pass it opaquely from `contractToSchema()` into `planner.plan({ schema })`.
- Type safety is maintained within the family: the postgres target knows both sides are `SqlSchemaIR`.

**Why not add a type parameter?** Adding `TSchemaIR` to `TargetMigrationsCapability` would cascade through `MigrationPlanner`, `MigrationRunner`, and every consumer that threads these generically. This is significant API surface churn for an internal detail that the framework layer treats as a pass-through.

This is the same pattern used by `ControlFamilyInstance.introspect()` (returns `unknown`), `validateContractIR` (accepts `unknown`), etc. The framework defines lifecycle and shape; the family fills in concrete types.

## Destructive operations: what's blocking them

Two things prevent destructive operations (DROP TABLE, DROP COLUMN, ALTER COLUMN SET NOT NULL, ALTER COLUMN TYPE, etc.):

### 1. The planner only generates additive SQL

`PostgresMigrationPlanner.plan()` produces SQL for additive changes (CREATE TABLE, ADD COLUMN, etc.). When it encounters a change that would require destructive SQL, it creates a `MigrationPlannerConflict` instead of generating the SQL:

- Removed table → `tableRemoved` conflict
- Removed column → `columnRemoved` conflict
- Nullable → non-nullable → `nullabilityConflict`
- Type change → `typeMismatch` conflict

There is no code path to generate `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN SET NOT NULL`, or `ALTER COLUMN TYPE` statements. The conflicts cause `plan()` to return `{ kind: 'conflict', conflicts }` which the CLI reports as errors.

### 2. `migration plan` hardcodes additive-only policy

`migration-plan.ts` calls `planner.plan()` with `policy: { allowedOperationClasses: ['additive'] }`. Even if the planner could produce destructive operations, this policy would reject them.

### What `migration apply` does

`migration apply` is policy-agnostic — it passes all operation classes to the runner (see RD-17 in spec.md). The policy gate belongs at plan time, not apply time.

### Path to supporting destructive operations

1. **Planner**: Add code paths to generate `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN SET NOT NULL`, `ALTER COLUMN TYPE`, etc. as `SqlMigrationPlanOperation` objects with `operationClass: 'destructive'`.
2. **`migration plan` policy**: Accept a flag (e.g., `--allow-destructive`) that relaxes the policy to `['additive', 'destructive']`.
3. **`migration apply`**: No changes needed — already derives policy from the operations.
4. **Safety**: The planner would likely still emit warnings or require confirmation for destructive operations, and the `MigrationRunner`'s pre/postchecks provide a safety net.
