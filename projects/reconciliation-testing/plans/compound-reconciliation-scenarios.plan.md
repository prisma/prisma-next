# Compound Reconciliation Scenarios Plan

## Summary

Add integration tests for realistic multi-change migration scenarios that exercise the planner→runner pipeline with multiple concurrent reconciliation operations. The goal is to discover bugs in operation ordering, cross-table coordination, and same-column interactions — not to fix them. Any failures are documented for separate follow-up.

**Spec:** `projects/reconciliation-testing/specs/compound-reconciliation-scenarios.spec.md`

## Status: Not started

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar Berg | Drives execution |

## Milestones

### Milestone 1: Same-column compound operations

Tests where multiple schema issues target the same column, requiring the planner to sequence dependent operations correctly.

**Tasks:**

- [ ] **Type + default change test**: Baseline `status text DEFAULT 'active'` → change to `status int4 DEFAULT 1`. Verify column type is `int4` AND default contains `1`. If it fails, document whether the issue is operation ordering (ALTER DEFAULT before ALTER TYPE) or something else.
- [ ] **Nullability + default test**: Baseline `label text NULL` (no default) → change to `label text NOT NULL DEFAULT 'unknown'`. Verify column is NOT NULL AND has default containing `'unknown'`. If SET NOT NULL runs before SET DEFAULT, it will fail on existing NULL rows — document the ordering behavior.

### Milestone 2: Cross-table and multi-object operations

Tests where operations span multiple tables or affect dependent database objects.

**Tasks:**

- [ ] **FK + parent table drop test**: Baseline with `parent` and `child` tables (child has FK + backing index to parent). Updated contract removes both the FK and the parent table entirely. Verify FK constraint is gone AND parent table is gone. If the planner tries to DROP TABLE before DROP CONSTRAINT, PG will error — document the failure.
- [ ] **Column + index drop test**: Baseline with table having a column and a named index on that column. Updated contract removes the column. Verify both the index and column are removed. PG cascades index drops with column drops, but the planner may try to drop the index on a column that no longer exists — document any ordering issue.

### Milestone 3: Mixed operations on same table

Tests that verify the planner handles multiple different operation classes targeting the same table.

**Tasks:**

- [ ] **Mixed nullability on same table**: Baseline with `col_a NOT NULL` and `col_b NULL`. Updated contract flips both: `col_a NULL` (widening) and `col_b NOT NULL` (destructive). Verify `col_a` is nullable AND `col_b` is NOT NULL.

### Milestone 4: Document findings

- [ ] **Document any bugs found**: For each failing test, record the failure mode, root cause (if identifiable), and affected code path in the plan's "Discovered Issues" section below.
- [ ] Run full postgres package suite to confirm no regressions from new tests (the tests themselves may fail, but existing tests must not break).

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Type + default change: column is `int4` with new default | Integration | M1 | Verify via `pg_attribute` + `information_schema.columns` |
| Nullability + default: column is NOT NULL with default | Integration | M1 | Verify via `information_schema.columns` |
| FK + parent table drop: no FK-violation, both gone | Integration | M2 | Verify via `pg_constraint` + `to_regclass` |
| Column + index drop: both removed | Integration | M2 | Verify via `information_schema.columns` + `to_regclass` |
| Mixed nullability: both columns changed correctly | Integration | M3 | Verify via `information_schema.columns` for both columns |
| All tests use planner→runner pipeline | Integration | All | Each test calls `planner.plan()` then `runner.execute()` |
| All tests verify via direct SQL | Integration | All | Each test queries catalog tables |
| No regressions to existing tests | Integration | M4 | Full postgres package suite passes |

## Discovered Issues

_To be filled in during execution. For each bug found:_

```
### Issue: <title>
**Test:** <which test exposed it>
**Failure mode:** <what happened — error message, wrong state, etc.>
**Root cause:** <if identifiable — which code path, what ordering assumption>
**Affected code:** <file paths>
**Severity:** <blocks scenario / produces wrong result / cosmetic>
```

## Open Items

- Operation ordering within a plan is implicit (based on issue sort order in `sortSchemaIssues` which sorts alphabetically by kind). There is no explicit dependency graph between operations. The M1 and M2 tests will reveal whether alphabetical ordering happens to be correct or whether it produces failures.
- Expression defaults (e.g., `dbgenerated('now()')`) are not covered. Could be a follow-up.
