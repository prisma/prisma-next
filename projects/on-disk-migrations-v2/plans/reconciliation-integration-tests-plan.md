# Reconciliation Integration Tests Plan

## Summary

Add end-to-end integration tests that prove reconciliation operations (ALTER COLUMN TYPE, SET DEFAULT, ALTER DEFAULT) work correctly against a live Postgres instance through the full planner→runner→verify pipeline. Uses existing test infrastructure from `runner-fixtures.ts`.

**Spec:** `projects/on-disk-migrations-v2/specs/reconciliation-integration-tests.spec.md`

## Status: Complete (Phase 2)

Phase 1 delivered 3 integration tests (ALTER COLUMN TYPE, SET DEFAULT, ALTER DEFAULT) and discovered the ALTER DEFAULT postcheck bug.

Phase 2 added the remaining 8 integration tests and uncovered 3 additional bugs in the verifier and planner that made several reconciliation operations unreachable.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar Berg | Drives execution |

## Milestones

### Milestone 1: Reconciliation integration tests ✅

Created `planner.reconciliation.integration.test.ts` with local contract factories and three end-to-end tests, reusing existing database/driver/planner/runner infrastructure from `runner-fixtures.ts`.

**Tasks:**

- [x] Create `planner.reconciliation.integration.test.ts` importing existing fixtures (`createTestDatabase`, `createDriver`, `resetDatabase`, `familyInstance`, `postgresTargetDescriptor`, `frameworkComponents`)
- [x] Add local `makeContract(tables)`, `makeTable(columns)` factories and `RECONCILIATION_POLICY` constant
- [x] **ALTER COLUMN TYPE test**: baseline with `text` column → introspect → plan type change to `int4` → apply → verify via `pg_attribute` / `regtype` query
- [x] **SET DEFAULT test**: baseline with no default → introspect → plan adding `DEFAULT 'untitled'` → apply → verify via `information_schema.columns`
- [x] **ALTER DEFAULT test**: baseline with `DEFAULT 'draft'` → introspect → plan changing to `DEFAULT 'active'` → apply → verify value changed and old value absent
- [x] Run full postgres package test suite — 137 tests pass across 18 files, no regressions

### Milestone 2: Full reconciliation integration coverage ✅

Added integration tests for all remaining reconciliation operations, achieving 100% operation coverage.

**Tasks:**

- [x] **DROP TABLE test**: baseline with extra table → introspect → plan drop → apply → verify via `to_regclass`
- [x] **DROP COLUMN test**: baseline with extra column → introspect → plan drop → apply → verify via `information_schema.columns`
- [x] **DROP INDEX test**: baseline with named index → introspect → plan drop → apply → verify via `to_regclass`
- [x] **DROP UNIQUE CONSTRAINT test**: baseline with named unique → introspect → plan drop → apply → verify via `pg_constraint`
- [x] **DROP FOREIGN KEY test**: baseline with FK + backing index → introspect → plan drop → apply → verify via `pg_constraint`
- [x] **DROP PRIMARY KEY test**: baseline with PK → introspect → plan drop → apply → verify via `pg_constraint`
- [x] **DROP NOT NULL test**: baseline NOT NULL → introspect → plan widen to nullable → apply → verify via `information_schema.columns`
- [x] **SET NOT NULL test**: baseline nullable → introspect → plan tighten to NOT NULL → apply → verify via `information_schema.columns`
- [x] Run full postgres package test suite — 145 tests pass, no regressions
- [x] Run family package test suite — 139 tests pass, no regressions

### Bugs discovered and fixed during Phase 1

#### Bug 1: ALTER DEFAULT postcheck only checked existence, not value

`buildAlterDefaultOperation` used `columnDefaultCheck` which only verified `column_default IS NOT NULL`. This caused the idempotency probe to skip execution when a column already had any default (same class as TML-2077).

- [x] Add unit test `default_mismatch postcheck verifies actual default value, not just existence`
- [x] Add `columnDefaultValueCheck` helper using `LIKE '%<expected>%'` to verify actual default value
- [x] Update `buildAlterDefaultOperation` to use `columnDefaultValueCheck`

### Bugs discovered and fixed during Phase 2

#### Bug 2: Verifier missing `indexOrConstraint` on extra-object issues

`verify-helpers.ts` did not populate `indexOrConstraint` on `extra_index`, `extra_unique_constraint`, or `extra_foreign_key` issues. Since `planner-reconciliation.ts` checks `!issue.indexOrConstraint` before building drop operations, these three reconciliation code paths were **unreachable dead code** — the planner could never produce drop-index, drop-unique, or drop-FK operations from schema verification.

- [x] Add `indexOrConstraint` to `extra_index` issues (using `schemaIndex.name` with fallback)
- [x] Add `indexOrConstraint` to `extra_unique_constraint` issues (using `schemaUnique.name` with fallback)
- [x] Add `indexOrConstraint` to `extra_foreign_key` issues (using `schemaFK.name` with fallback)

**Files:** `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-helpers.ts`

#### Bug 3: Verifier skipped FK check when contract had no FKs

`verify-sql-schema.ts` only called `verifyForeignKeys()` when the contract table had `constraint: true` foreign keys (`constraintFks.length > 0`). In strict mode, if the contract had no FKs but the database did, the extra FKs were invisible — `verifyForeignKeys` was never invoked, so the strict-mode extra-FK detection never ran.

- [x] Change guard to `constraintFks.length > 0 || strict` so extra-FK detection runs in strict mode regardless

**Files:** `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts`

#### Refactor: Co-locate check helpers in planner.ts

`columnTypeCheck`, `columnDefaultCheck`, and `columnDefaultValueCheck` were private functions in `planner-reconciliation.ts` instead of being exported from `planner.ts` alongside the other check helpers (`columnExistsCheck`, `columnNullabilityCheck`, `constraintExistsCheck`).

- [x] Move all three to `planner.ts` as exported functions
- [x] Import them in `planner-reconciliation.ts`

**Files:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`, `planner-reconciliation.ts`

## Test Coverage

| Acceptance Criterion | Test Type | Status | Notes |
|---|---|---|---|
| ALTER COLUMN TYPE changes type after apply | Integration | ✅ | Verified via `pg_attribute` + `regtype` query |
| SET DEFAULT adds default after apply | Integration | ✅ | Verified via `information_schema.columns` |
| ALTER DEFAULT changes default after apply | Integration | ✅ | Verified via `information_schema.columns` — value match, old value absent |
| DROP TABLE removes table after apply | Integration | ✅ | Verified via `to_regclass` |
| DROP COLUMN removes column after apply | Integration | ✅ | Verified via `information_schema.columns` |
| DROP INDEX removes index after apply | Integration | ✅ | Verified via `to_regclass` |
| DROP UNIQUE removes constraint after apply | Integration | ✅ | Verified via `pg_constraint` |
| DROP FOREIGN KEY removes FK after apply | Integration | ✅ | Verified via `pg_constraint` |
| DROP PRIMARY KEY removes PK after apply | Integration | ✅ | Verified via `pg_constraint` |
| DROP NOT NULL makes column nullable | Integration | ✅ | Verified via `information_schema.columns` |
| SET NOT NULL makes column non-nullable | Integration | ✅ | Verified via `information_schema.columns` |
| Tests use planner→runner pipeline | Integration | ✅ | Each test calls `planner.plan()` then `runner.execute()` |
| Final DB state verified via direct SQL | Integration | ✅ | Each test queries catalog tables |
| No regressions | Integration | ✅ | 145/145 postgres tests, 139/139 family tests |
| ALTER DEFAULT postcheck verifies value | Unit | ✅ | Bug fix — postcheck now uses `columnDefaultValueCheck` |

## Files Changed

| File | Change |
|---|---|
| `test/migrations/planner.reconciliation.integration.test.ts` | New — 11 integration tests (3 phase 1 + 8 phase 2) |
| `test/migrations/planner.reconciliation-unit.test.ts` | Added unit test for ALTER DEFAULT postcheck bug |
| `src/core/migrations/planner.ts` | Exported `columnTypeCheck`, `columnDefaultCheck`, `columnDefaultValueCheck` |
| `src/core/migrations/planner-reconciliation.ts` | Imported check helpers from `planner.ts`, removed private duplicates |
| `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-helpers.ts` | Added `indexOrConstraint` to extra-index/unique/FK issues |
| `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts` | Fixed FK verification to run in strict mode even when contract has no FKs |
