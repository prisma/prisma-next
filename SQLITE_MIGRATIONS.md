# SQLite Migrations (Prisma Next)

This document describes the current SQLite migration scope in Prisma Next and a future roadmap for broader migration support.

It is intentionally **target-owned**: the implementation lives in `@prisma-next/target-sqlite` and must not leak dialect-specific logic into SQL family lanes/runtime.

## Current Scope (MVP)

SQLite migrations are currently **additive-only** and optimized for the primary MVP flow:

- `prisma-next db init` on an empty SQLite database file
- contract marker + ledger tables written in the same DB

The SQLite migration planner/runner live in:

- `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts`
- `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts`

### Supported Operations

- Create missing tables
- Create missing columns (nullable only)
- Create indexes / unique indexes (where supported by SQLite)
- Create foreign keys as part of **new table creation**
- Create and maintain target-owned control tables:
  - `prisma_contract_marker`
  - `prisma_contract_ledger`

### Explicitly Unsupported (For Now)

These changes require a table rebuild strategy and are expected to fail fast with actionable errors:

- Dropping columns
- Changing column types or nullability
- Changing default expressions
- Adding/removing/changing foreign keys on existing tables
- Renaming tables/columns (unless represented as drop+add with rebuild)
- Altering primary keys

## Why This Is Hard In SQLite

SQLite has limited `ALTER TABLE` support. Many schema changes require:

- Creating a new table with the desired schema
- Copying data over
- Dropping the old table
- Renaming the new table
- Recreating indexes and constraints

This is feasible, but it has non-trivial edge cases and needs a careful, deterministic planner so `db init` and `db verify` remain reliable.

## Roadmap: Full Diff Migrations (Plan B)

This section describes a concrete future approach to support broader diffs while preserving Prisma Next architectural boundaries.

### 1) Detect Which Tables Need Rebuild

During planning, classify per-table diffs into:

- **Additive** (can be done with CREATE TABLE / ADD COLUMN / CREATE INDEX)
- **Rebuild-required** (anything that SQLite cannot express as a safe ALTER)

Examples of rebuild-required diffs:

- Drop/rename column
- Type change
- Not-null change
- PK change
- FK change on existing table

### 2) Rebuild Algorithm (Single Table)

For each table `T` that must be rebuilt:

1. Compute `T_new` schema from the **desired contract**.
1. Create a temp table, e.g. `__prisma_next_new_T`:
   - Use the desired column list, PK, FKs, and constraints.
1. Copy data:
   - `INSERT INTO __prisma_next_new_T(colA, colB, ...) SELECT oldA, oldB, ... FROM T;`
   - For dropped/renamed columns, omit or map them.
   - For new NOT NULL columns, require a default or fail the plan.
1. Drop old table `T`.
1. Rename temp table to `T`.
1. Recreate indexes (and any triggers/views if Prisma Next ever owns them).

Transaction strategy:

- Prefer one transaction per rebuild wave.
- Use `BEGIN IMMEDIATE` to avoid mid-migration write races.
- Temporarily disable FK enforcement if required for the drop/rename steps:
  - `PRAGMA foreign_keys = OFF` (then re-enable and validate at the end).

### 3) Dependency Ordering (Multiple Tables)

When multiple tables require rebuild, plan in waves:

- Rebuild tables without inbound FKs first (or disable FKs temporarily).
- Rebuild referenced tables before referencing tables if enforcing FKs during copy.

If FK disable is used, do a final validation phase:

- `PRAGMA foreign_key_check`
- Fail with a structured error that includes the violating row/table.

### 4) Data Safety and Explicit Failures

A rebuild plan must fail fast when it cannot guarantee correctness, for example:

- Dropping a column would lose required data and there is no explicit mapping.
- Type conversion is lossy or invalid for existing values.
- New NOT NULL column has no default and no mapping.

These failures must be reported as stable errors with:

- the table/column involved
- what diff triggered the rebuild
- the required user action (e.g. "provide a default" or "write a manual migration")

### 5) How This Fits Prisma Next Boundaries

- The **planner/runner** remain fully within `@prisma-next/target-sqlite`.
- SQL family runtime/lane remains dialect-agnostic (no branching on `sqlite`).
- Introspection stays adapter-owned (`@prisma-next/adapter-sqlite`) and should not embed migration logic.
- Marker and ledger schema remain target-owned and must be excluded from strict schema verification.

## Testing Strategy

When implementing Plan B, add targeted tests under `@prisma-next/target-sqlite`:

- Unit tests for diff classification (additive vs rebuild)
- Golden tests for planned SQL statements
- Integration tests with a real temp DB file:
  - seed schema v1 + data
  - migrate to v2 via rebuild
  - verify data preservation and FK correctness

