# Summary

Add integration tests that exercise reconciliation operations (ALTER COLUMN TYPE, SET DEFAULT, ALTER DEFAULT) end-to-end through the planner→runner pipeline against a live Postgres instance. These operations currently have only unit-level coverage that checks the shape of generated SQL but never executes it against a real database.

# Description

The reconciliation layer in `planner-reconciliation.ts` handles schema issues that require modifying existing objects (as opposed to additive operations that create new objects). Two recent fixes (TML-2076 and TML-2077) added operation builders for column defaults and fixed a weak postcheck on ALTER COLUMN TYPE. Both bugs would have been caught by integration tests that exercise the full plan→apply→verify cycle.

### Current integration test coverage

The existing integration tests in `packages/3-targets/3-targets/postgres/test/migrations/` cover:
- Additive operations: table creation, column addition, unique constraints, indexes, enum types
- Runner mechanics: idempotency, policy enforcement, error handling, rollback, execution checks
- Schema verification: drift detection after manual DB changes

No integration test exercises **reconciliation operations** — the class of operations that modify existing database objects via ALTER TABLE statements.

### What needs testing

Each reconciliation operation follows a two-step flow:
1. **Establish baseline**: Create initial contract → plan from empty schema → apply → verify
2. **Apply change**: Create modified contract → introspect live DB → plan with reconciliation policy → apply → verify the change took effect

The operations to test:
- **ALTER COLUMN TYPE** — change a column's native type (e.g., `text` → `int4`)
- **SET DEFAULT** (default_missing) — add a default to a column that had none
- **ALTER DEFAULT** (default_mismatch) — change an existing default to a new value

### Test infrastructure needed

The existing `runner-fixtures.ts` exports a single static `contract` and `INIT_ADDITIVE_POLICY`. Reconciliation tests need:
- A contract factory that accepts table/column definitions (following the per-file local factory pattern used throughout the codebase)
- A reconciliation-capable policy that allows widening and destructive operations
- A helper to run the baseline setup (plan from empty → apply) to avoid repetition

# Requirements

1. Add a new integration test file for reconciliation operations that runs against a live Postgres instance
2. Test ALTER COLUMN TYPE end-to-end: baseline with type A → plan type change to B → apply → verify column has new type
3. Test SET DEFAULT end-to-end: baseline with no default → plan adding a default → apply → verify default is set
4. Test ALTER DEFAULT end-to-end: baseline with default A → plan changing to default B → apply → verify new default
5. Follow existing test patterns: local contract factory, same fixture infrastructure (`createTestDatabase`, `createDriver`, `resetDatabase`), same `describe.sequential` structure

# Acceptance Criteria

1. ALTER COLUMN TYPE integration test passes: column type changes from `text` to `integer` after migration apply
2. SET DEFAULT integration test passes: column gains a default value after migration apply
3. ALTER DEFAULT integration test passes: column default changes from old value to new value after migration apply
4. All tests use the planner→runner pipeline (not hand-crafted plans), proving the generated operations work against real Postgres
5. All tests verify the final database state via direct SQL queries (not just runner success)
6. Existing tests continue to pass (no regressions)
