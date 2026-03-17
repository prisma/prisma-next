# Summary

Add integration tests for compound reconciliation scenarios — migrations that produce multiple reconciliation operations in a single plan. The existing single-operation tests verify each operation in isolation; these tests verify that the planner and runner handle realistic multi-change migrations correctly, including operation ordering, cross-table coordination, and same-column interactions.

# Description

### Context

Phase 1–2 of reconciliation integration testing achieved 100% coverage of individual operations (11 tests). However, real migrations rarely change a single thing. A typical schema evolution involves multiple concurrent changes — adding a column while dropping another, changing a type and its default together, removing a FK before dropping its parent table.

These compound scenarios stress different parts of the system:
- **Operation ordering**: some operations must execute before others (e.g., drop FK before drop table)
- **Same-column interactions**: multiple issues on one column (type + default, nullability + default)
- **Cross-table coordination**: changes that span parent/child relationships
- **Mixed operation classes**: widening + destructive in a single plan

### Current state

All 11 individual reconciliation operations have integration tests:
- DROP TABLE, DROP COLUMN, DROP INDEX, DROP UNIQUE, DROP FK, DROP PK
- DROP NOT NULL, SET NOT NULL
- ALTER COLUMN TYPE, SET DEFAULT, ALTER DEFAULT

The compound scenarios below build on this foundation using the same test infrastructure (`makeContract`, `makeTable`, `applyBaseline`, `introspectSchema`).

### Scenarios to test

**1. Change column type and default together**
A column changes from `text DEFAULT 'active'` to `int4 DEFAULT 1`. Produces `type_mismatch` + `default_mismatch` on the same column. Tests that the planner sequences ALTER TYPE before ALTER DEFAULT (the old default expression is invalid for the new type).

**2. Tighten nullability and add a default**
A nullable column with no default becomes `NOT NULL DEFAULT 'unknown'`. Produces `nullability_mismatch` + `default_missing` on the same column. The SET DEFAULT should ideally execute before SET NOT NULL so existing NULL rows get the default.

**3. Drop a foreign key and its parent table**
Remove a child table's FK constraint, then drop the parent table entirely. Produces `extra_foreign_key` on the child + `extra_table` on the parent. Tests that the planner drops the FK before the table (FK depends on parent existing).

**4. Widen and tighten different columns on the same table**
One column becomes nullable (widening), another becomes NOT NULL (destructive). Tests that mixed operation classes on the same table are handled correctly.

**5. Drop a column and its index**
A column with an index is removed. Produces `extra_index` + `extra_column`. The index must be dropped before the column (PG would cascade, but explicit ordering is cleaner).

### Approach

Write the tests first. If any scenario exposes a bug (e.g., wrong operation ordering, runner failure), document the failure and the root cause. Fixes are a separate follow-up — the goal here is to discover what breaks.

# Requirements

1. Add compound reconciliation integration tests to the existing `planner.reconciliation.integration.test.ts` file
2. Each test follows the established pattern: baseline contract → apply → modified contract → introspect → plan → apply → verify
3. Tests must verify final DB state via direct SQL catalog queries (not just runner success)
4. Tests must use the planner→runner pipeline, not hand-crafted plans
5. Document any failures as bugs for later investigation rather than fixing inline

# Acceptance Criteria

1. Type + default change test: column type changes to `int4` AND default changes to new value
2. Nullability + default test: column becomes NOT NULL AND gains a default
3. FK + parent table drop test: FK constraint is removed AND parent table is dropped, with no FK-violation errors during execution
4. Mixed nullability test: one column is nullable, another is NOT NULL, both on the same table
5. Column + index drop test: both the index and column are removed
6. All tests use the planner→runner pipeline
7. All tests verify final DB state via direct SQL queries
8. Existing tests continue to pass (no regressions)
