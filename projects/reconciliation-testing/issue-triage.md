# Issue Triage

Issues discovered during project work, captured for later investigation and potential Linear ticket creation.

---

## Planner drops unique constraint that a FK depends on

**Discovered:** 2026-03-17 | **Severity:** high

**Observed:** When the contract removes a unique constraint from a parent table while a child table's FK still references those columns, the planner emits a DROP CONSTRAINT operation. PG refuses with error `2BP01`: `cannot drop constraint parent_code_key on table parent because other objects depend on it` — the child FK depends on the unique index.

**Location:**
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-reconciliation.ts` (`buildDropConstraintOperation`)
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-reconciliation.ts` (`buildReconciliationPlan` — no dependency graph between operations)

**Impact:** Runner execution fails. Any reconciliation plan that drops a unique constraint referenced by a FK on another table will fail at execution time. The planner has no way to detect this dependency or emit a conflict instead.

**Suggested fix:** Either (a) add a dependency-aware check that detects when a unique constraint is referenced by a FK and converts it to a conflict, or (b) implement CASCADE awareness so the planner can sequence FK drop before unique drop when both are being removed, or (c) emit the DROP CONSTRAINT with CASCADE (risky — would silently drop the FK).

**Context:** Exposed by integration test `drops unique constraint while FK still references the column` in `planner.reconciliation.integration.test.ts`.

---

## ~~Verifier does not detect "extra default" on a column~~ (FIXED — TML-2091)

**Discovered:** 2026-03-17 | **Severity:** high | **Fixed:** 2026-03-19

**Observed:** When a column in the database has a DEFAULT but the contract specifies no default, the verifier does not report any issue. The default silently remains after migration. For example, changing `NOT NULL DEFAULT 'active'` to `NULL` (no default) correctly widens nullability but leaves the stale `'active'::text` default in place.

**Location:**
- `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts` (column verification logic — no check for extra defaults)
- `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-helpers.ts` (no `extra_default` issue kind)
- `packages/1-framework/1-core/migration/control-plane/src/types.ts` (`SchemaIssue` — missing `extra_default` kind)

**Impact:** Silent data issue. The database retains a default the contract doesn't expect. This could cause subtle bugs: new rows get a default value that the application doesn't account for. The `default_missing` and `default_mismatch` issue kinds only cover cases where the contract *wants* a default — there's no inverse for when the contract wants *no* default.

**Suggested fix:** Add an `extra_default` issue kind to `SchemaIssue`, detect it in the column verifier when `contractColumn.default` is undefined but `schemaColumn.default` is present, and add a `buildDropDefaultOperation` in `planner-reconciliation.ts` that emits `ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT`.

**Context:** Exposed by integration test `widens nullability and drops default from a NOT NULL DEFAULT column` in `planner.reconciliation.integration.test.ts`.

---

## Primary key mismatch has no reconciliation operation builder

**Discovered:** 2026-03-17 | **Severity:** medium

**Observed:** When the contract specifies a different primary key than what exists in the database (e.g., switching PK from `id` to `uuid`), the planner returns `kind: "failure"` with a `indexIncompatible` conflict. The `primary_key_mismatch` issue kind falls through to the default case in `buildReconciliationOperationFromIssue`, which returns `null`.

**Location:**
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-reconciliation.ts` (lines 219-226 — explicit comment acknowledging the gap)

**Impact:** Any migration that changes which columns form the primary key cannot be reconciled automatically. The user must manually drop the old PK and create the new one. This is acknowledged in the code as a known gap. Same applies to `unique_constraint_mismatch`, `index_mismatch`, and `foreign_key_mismatch`.

**Suggested fix:** Add a `buildReplacePrimaryKeyOperation` that emits DROP CONSTRAINT (old PK) + ADD CONSTRAINT (new PK) as two steps within a single operation. Similar builders needed for the other mismatch kinds. These are destructive operations (dropping a PK removes the uniqueness guarantee during the window).

**Context:** Exposed by integration test `replaces primary key (drop old PK + add new PK on different column)` in `planner.reconciliation.integration.test.ts`. The comment at line 219 already documents this as a known limitation.
