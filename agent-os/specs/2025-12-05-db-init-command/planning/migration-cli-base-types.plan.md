# Plan — Core Migration Base Types for Framework CLI (remove `db init` duck typing)

## Problem

The current `db init` command in `@prisma-next/cli` is forced to **duck-type** the migration planner/runner and to cast the plan shape to extract fields for output:

- CLI is framework/core, but migration planner/runner types currently live in SQL family / target packages.
- `db init` needs a stable way to print/JSON-encode a plan and execution summary.
- Without a shared vocabulary, the CLI ends up with `unknown` casts like:
  - `planner.plan(...) as { kind: 'success' | 'failure'; plan?: unknown; conflicts?: unknown[] }`
  - `plannerResult.plan as { targetId; destination; operations[] }`

This is fragile and obscures the boundary between:
- “migration capability exists for this target/family”
- “what minimal data the CLI needs to present a plan/result”

## Goal

Introduce a **small, family-agnostic migration surface** in framework core that:

- Gives CLI a stable base type for:
  - plan summary (targetId, destination hashes, operation list)
  - execution summary (ops planned/executed)
  - conflict list (for planning failures)
- Treats migrations as an **optional capability**: families/targets that don’t support migrations simply don’t expose it.

This removes duck typing and keeps the framework CLI from importing SQL-family-specific types.

## Non-goals

- Enforcing that all families implement migrations (document/Mongo may not have them).
- Making the base types fully typed over contract/schema shapes (CLI doesn’t need that).
- Moving planner/runner implementations out of targets (they remain target-specific).

## Proposed Design

### 1) Add core migration types (display-oriented)

Add a minimal set of types to the framework control-plane package (alongside other control-plane domain action types):

- `MigrationOperationClass = 'additive' | 'widening' | 'destructive'`
- `MigrationOperationPolicyBase` (allowed classes)
- `MigrationPlanBase`
- `MigrationPlannerResultBase` (success/failure w/ conflicts)
- `MigrationRunnerResultBase` (success/failure w/ structured failure)

Keep the plan intentionally small and serializable:

- plan metadata:
  - `targetId`
  - `origin?` / `destination` hashes
- operations:
  - `id`
  - `label`
  - `operationClass`
  - (optional) a generic `target` descriptor for grouping (`{ id: string; details?: Record<string, unknown> }`)

### 2) Make “migration support” an optional target capability

Extend the target descriptor shape used by config/CLI with an **optional** migration property:

```ts
interface TargetMigrationsCapability {
  createPlanner(family: ControlFamilyInstance): MigrationPlannerBase;
  createRunner(family: ControlFamilyInstance): MigrationRunnerBase;
}

interface ControlTargetDescriptor<...> {
  // existing target fields...
  readonly migrations?: TargetMigrationsCapability;
}
```

Then:
- SQL targets (Postgres) set `migrations: { createPlanner, createRunner }`.
- Non-migration targets omit `migrations`.

The CLI can do:
- `if (!config.target.migrations) throw errorTargetMigrationNotSupported()`
- no need for “fake methods that throw”.

### 3) Bridge existing SQL types without breaking them

SQL family/target can keep their richer types. They just need to be assignable to the base interfaces.

Two ways:
- Make the SQL `MigrationPlan` structurally extend `MigrationPlanBase`
- Or return a thin wrapper at the target boundary that adapts the SQL plan to the base plan (prefer structural compatibility to avoid wrapper churn)

### 4) Update `db init` implementation to use base types

Refactor `db-init.ts` to:

- Require `config.target.migrations`
- Use base planner/runner interfaces
- Remove ad-hoc casts for `plannerResult` and `migrationPlan`
- Keep JSON output stable since it’s now derived from `MigrationPlanBase`

### 5) Tests

- Unit tests in CLI integration suite should assert:
  - planner failure returns conflicts list in structured error meta
  - plan JSON output contains base fields without relying on SQL-specific structure
- No need for special tests for non-migration targets beyond “command errors with not supported”.

## Rationale

This is the “thin core, fat targets” version of migrations:

- Targets own execution details and SQL.
- Core owns *vocabulary* needed for orchestration and user-facing output.
- Migrations remain optional across families/targets without inventing fake implementations.


