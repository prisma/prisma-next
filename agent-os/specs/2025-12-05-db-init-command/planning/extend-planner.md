@@ -0,0 +1,204 @@
---
name: Priority 2 — db init planning for existing databases (subset/superset/conflicting)
status: draft
owners:
  - postgres-target
  - sql-family
  - cli
---

# Priority 2 — Make `db init` “real” for existing databases (subset/superset/conflicting)

## Problem

Today the Postgres migration planner behaves like:

- **Empty DB** → plan “create everything”
- **Non-empty DB** → fail with “unsupported” (even if the DB already satisfies the contract or only needs additive changes)

This blocks the intended Branch 5 matrix and makes `db init` feel like a demo.

## Goal (what to build)

Upgrade the Postgres migration planner so `db init` can handle three non-empty states safely under an **additive-only policy**:

- **Subset DB**: DB has *some* required schema but is missing pieces → plan **only missing additive operations**
- **Superset DB**: DB satisfies contract requirements but has extra objects → return **empty/no-op plan**, still allow marker/ledger update
- **Conflicting DB**: DB has incompatible objects → return **planner failure** with a complete conflict list; do not attempt non-additive changes

Runner remains “execute plan operations” and stays additive-only.

## Non-goals / constraints

- No destructive changes: no drops, no type alterations, no `SET NOT NULL`, etc.
- No data migrations.
- No “perfect introspection of every Postgres nuance” — only the schema surface represented in `SqlSchemaIR`.

## Current state (evidence)

The Postgres planner currently rejects non-empty schemas:

```ts
const existingTables = Object.keys(options.schema.tables);
if (existingTables.length > 0) {
  return plannerFailure([{ kind: 'unsupportedOperation', ... }]);
}
```

The SQL family already has a **pure verifier** that compares `SqlSchemaIR` vs contract:

- `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts` → `verifySqlSchema({ strict, dependencyProviders, ... })`

## Core idea: reuse the pure verifier as the diff engine

We reuse `verifySqlSchema({ strict: false, ... })` (extras tolerated) and partition its output into:

- **Additive-fixable missing items** → plan operations
- **Non-additive conflicts** → planner failure with all conflicts
- **Extras** → ignored (since `strict: false`, we should not emit `extra_*` issues)

### Why this works

- Verifier already produces a stable `SchemaIssue[]` and contract-shaped tree.
- Planner can treat verifier output as the source of truth about “missing vs mismatched”.
- Planner does not need to introspect SQL strings or invent a second diff implementation.

## Issue → action mapping

The verifier’s `SchemaIssue.kind` values are defined in `@prisma-next/core-control-plane/types`:

- Additive-fixable (missing):
  - `missing_table`
  - `missing_column`
  - `extension_missing` (via dependency providers)
  - `primary_key_mismatch` **when the schema table has no primary key** (treated as “missing”)
  - `unique_constraint_mismatch` **when the unique is missing** (not “name mismatch”)
  - `index_mismatch` **when the index is missing** (not “name mismatch”)
  - `foreign_key_mismatch` **when the fk is missing** (not “name mismatch”)

- Non-additive conflicts:
  - `type_mismatch`
  - `nullability_mismatch`
  - `primary_key_mismatch` when present-but-different (wrong columns / wrong name)
  - `unique_constraint_mismatch` when present-but-incompatible (name mismatch)
  - `index_mismatch` when present-but-incompatible (name mismatch)
  - `foreign_key_mismatch` when present-but-incompatible (name mismatch)

Notes:

- Today some constraint verifiers use `*_mismatch` for both “missing” and “mismatch”.
  - Planner must disambiguate using schema IR presence (preferred) or `issue.actual` presence (fallback).
- The mapping must be deterministic: same schema IR + contract → same planned ops/conflict list ordering.

## High-level algorithm (planner behavior)

Inputs: `SqlMigrationPlannerPlanOptions` (contract + schema IR + policy + dependencyProviders + optional schemaName).

1) Enforce additive-only policy (existing behavior).
2) Run `verifySqlSchema({ contract, schema, strict: false, dependencyProviders, typeMetadataRegistry: empty })`.
3) If `verifyResult.ok === true`:
   - **Superset/exact** → return `success` with `operations: []`.
4) Otherwise:
   - Partition into `additiveMissing` vs `nonAdditiveConflicts`.
   - If any `nonAdditiveConflicts` exist → return `failure` with all conflicts.
   - Else → **Subset** → return `success` with plan containing only operations that add missing items.

## Operation builders needed (additive-only, partial schema)

We should reuse the existing operation builders where possible, but gate emission based on what exists in `SqlSchemaIR`.

Required builders:

- Missing DB dependencies (already modeled via `dependencyProviders`):
  - Include dependency install operations only when `verifyDatabaseDependenciesInstalled(schemaIR)` reports issues.
- Missing table:
  - `CREATE TABLE …`
- Missing column on existing table:
  - `ALTER TABLE … ADD COLUMN …` (new builder)
- Missing unique constraint:
  - Either `CREATE UNIQUE INDEX …` (current code uses an index-shaped operation id for uniques)
- Missing non-unique index:
  - `CREATE INDEX …`
- Missing foreign key:
  - `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY …`
- Missing primary key (only when table exists and PK missing):
  - `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY …`

Explicitly not supported in this slice:

- Adding NOT NULL to an existing nullable column
- Type changes
- Dropping/replacing keys

## Plan output invariants

- **Superset**: operations array is empty; runner still signs (marker/ledger writes are idempotent)
- **Subset**: operations contain only additive steps needed to satisfy the contract
- **Conflicting**: planner failure contains *all* conflicts, not just first; no operations returned

## Implementation steps (tests first)

### Step 1 — Unit tests for planner behavior (superset/subset/conflicting)

Update/add tests in `packages/3-targets/3-targets/postgres/test/migrations/`:

- superset: schema satisfies contract + extras → `success` + `operations: []`
- subset: schema missing a column/index/fk/pk → `success` + only those operation ids
- conflicting: schema has wrong `nativeType` or nullability mismatch → `failure` listing all conflicts

Assertions:

- Prefer object matchers (`toMatchObject`) for structured expectations.
- Omit “should” in test names.

### Step 2 — Extract a “verify + classify” helper (planner-internal)

Add a helper in Postgres planner to:

- call `verifySqlSchema({ strict: false, dependencyProviders, ... })`
- return `{ ok, additiveMissing, nonAdditiveConflicts }` (stable ordering)

### Step 3 — Remove the “non-empty DB unsupported” gate

Replace the early bailout with the classification flow described above.

### Step 4 — Add partial-schema builders

Implement `ALTER TABLE … ADD COLUMN …` builder and gate all existing builders against schema IR.

### Step 5 — Integration tests with real Postgres (must-have)

Use `withDevDatabase` + `withClient` from `@prisma-next/test-utils` (respect single-connection limitation):

- Subset integration: create partial schema, run planner+runner, verify schema passes, marker written.
- Superset integration: create schema that satisfies contract + extras, plan empty, runner executes 0 ops, marker written.
- Conflicting integration: create incompatible schema (type mismatch), plan fails, schema unchanged.

### Step 6 — CLI tests (optional in this slice, but likely next)

Add e2e cases for `prisma-next db init` in the CLI fixture app once the planner behavior is stable.

## Key files to modify

- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
- `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts` (read-only dependency for planning)
- `packages/3-targets/3-targets/postgres/test/migrations/planner.*.test.ts`
- `packages/3-targets/3-targets/postgres/test/migrations/*.integration.test.ts` (new)

## Open design decision (wiring): how planner calls the pure verifier

We need one of:

- **A) Family-owned pure verifier method**: add a `verifySchemaIR(...)` helper on `SqlControlFamilyInstance` and pass it through `target.migrations.createPlanner(family)`.
- **B) Export pure verifier**: export `verifySqlSchema` from `@prisma-next/family-sql/control` (or another migration-plane export) so the Postgres target can call it without reaching into non-exported internals.

Recommendation for “thin targets, fat family”: **A**.

## Done criteria

- Planner supports subset/superset/conflicting under additive-only:
  - Subset → success with only missing additive operations
  - Superset → success with `operations: []`
  - Conflicting → failure with complete conflict list
- Runner behavior unchanged (executes whatever plan is provided; supports 0 ops).

