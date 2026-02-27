# Postgres Referential Actions — Task List

Implementation tasks for adding `ON DELETE` and `ON UPDATE` referential actions to foreign keys. Postgres-only; no emulation for other targets.

---

## Phase 1: Contract IR and Types

### 1.1 Contract IR — ReferentialAction type and ForeignKey extension

- [ ] **TASK-001** Add `ReferentialAction` type and extend `ForeignKey` in contract IR
  - **File:** `packages/2-sql/1-core/contract/src/types.ts`
  - **Actions:**
    - Add `export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';`
    - Extend `ForeignKey` with optional `readonly onDelete?: ReferentialAction; readonly onUpdate?: ReferentialAction;`
  - **Export:** Add to `packages/2-sql/1-core/contract/src/exports/types.ts`

### 1.2 Validators — ForeignKey schema and semantic rules

- [ ] **TASK-002** (TDD) Write failing tests for `ForeignKey` validator with `onDelete`/`onUpdate`
  - **File:** `packages/2-sql/1-core/contract/test/validators.test.ts`
  - **Test:** Validator accepts all `ReferentialAction` values for `onDelete` and `onUpdate`
  - **Test:** Validator rejects invalid action strings
  - **Run:** `pnpm test` in `packages/2-sql/1-core/contract`

- [ ] **TASK-003** Extend `ForeignKeySchema` and validator to accept optional `onDelete`/`onUpdate`
  - **File:** `packages/2-sql/1-core/contract/src/validators.ts`
  - **Actions:** Add optional `onDelete`, `onUpdate` to `ForeignKeySchema` with action literal union
  - **Depends on:** TASK-001

### 1.3 Factories — fk() with referential action options

- [ ] **TASK-004** (TDD) Write failing tests for `fk()` factory with `onDelete`/`onUpdate`
  - **File:** `packages/2-sql/1-core/contract/test/factories.test.ts`
  - **Test:** `fk([...], 'table', [...], { onDelete: 'cascade' })` returns correct shape
  - **Test:** All `ReferentialAction` values produce valid `ForeignKey`

- [ ] **TASK-005** Extend `fk()` factory to accept optional options object with `onDelete`/`onUpdate`
  - **File:** `packages/2-sql/1-core/contract/src/factories.ts`
  - **Signature:** `fk(columns, refTable, refColumns, nameOrOptions?: string | { name?: string; onDelete?: ReferentialAction; onUpdate?: ReferentialAction })`
  - **Depends on:** TASK-004

### 1.4 Canonicalization — Omit defaults for stable hash

- [ ] **TASK-006** (TDD) Write failing test: omitted `onDelete`/`onUpdate` produce same hash as explicit defaults
  - **File:** `packages/1-framework/1-core/migration/control-plane/test/` (or canonicalization test location)
  - **Verify:** `omitDefaults` does not include `onDelete`/`onUpdate` when undefined

- [ ] **TASK-007** Extend `omitDefaults` to handle FK `onDelete`/`onUpdate` (omit when undefined)
  - **File:** `packages/1-framework/1-core/migration/control-plane/src/emission/canonicalization.ts`
  - **Actions:** Ensure FK objects with omitted referential actions are normalized consistently
  - **Depends on:** TASK-006

### 1.5 Contract package README

- [ ] **TASK-008** Update `packages/2-sql/1-core/contract/README.md` with `ReferentialAction` and `ForeignKey.onDelete`/`onUpdate` documentation

---

## Phase 2: Builder and Authoring Layer

### 2.1 Table builder — ForeignKeyDef and foreignKey() options

- [ ] **TASK-009** (TDD) Write failing tests for `.foreignKey()` with options object
  - **File:** `packages/1-framework/2-authoring/contract/test/table-builder.test.ts`
  - **Test:** `.foreignKey(['userId'], { table: 'user', columns: ['id'] }, { onDelete: 'cascade', onUpdate: 'noAction' })` builds correct state
  - **Test:** All `ReferentialAction` values accepted
  - **Test:** Backward compat: `.foreignKey(cols, refs, name)` and `.foreignKey(cols, refs)` still work

- [ ] **TASK-010** Extend `ForeignKeyDef` and `.foreignKey()` to accept options object
  - **File:** `packages/1-framework/2-authoring/contract/src/builder-state.ts` — add `onDelete?`, `onUpdate?` to `ForeignKeyDef`
  - **File:** `packages/1-framework/2-authoring/contract/src/table-builder.ts` — change `.foreignKey(columns, references, nameOrOptions?)` overloads to accept `{ name?, onDelete?, onUpdate? }`
  - **Depends on:** TASK-009

### 2.2 Contract builder — Propagate referential actions to storage

- [ ] **TASK-011** Verify `BuildStorage`/transform chain propagates `onDelete`/`onUpdate` from `ForeignKeyDef` to contract `ForeignKey`
  - **Scope:** Type-level and runtime propagation from table builder state → contract JSON
  - **File:** Contract builder transform logic (e.g. `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts` or equivalent)
  - **Depends on:** TASK-010

---

## Phase 3: Schema IR and Introspection

### 3.1 Schema IR — SqlForeignKeyIR extension

- [ ] **TASK-012** Add optional `onDelete`/`onUpdate` to `SqlForeignKeyIR`
  - **File:** `packages/2-sql/1-core/schema-ir/src/types.ts`
  - **Add:** `readonly onDelete?: ReferentialAction; readonly onUpdate?: ReferentialAction;`
  - **Note:** Import or redefine `ReferentialAction` (or use string literal union) to avoid coupling to contract package if layered

### 3.2 Postgres control adapter — Read delete_rule and update_rule

- [ ] **TASK-013** (TDD) Write failing integration test: introspected schema contains referential actions
  - **File:** `packages/3-targets/6-adapters/postgres/test/` — new or existing introspect test
  - **Setup:** Create table with FK `ON DELETE CASCADE`, introspect, assert `onDelete: 'cascade'` in schema IR

- [ ] **TASK-014** Extend Postgres FK query to join `information_schema.referential_constraints`
  - **File:** `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`
  - **Actions:**
    - Join FK query with `referential_constraints` on `constraint_name`/`table_schema`
    - Select `delete_rule`, `update_rule`
    - Map Postgres values to camelCase: `NO ACTION` → `noAction`, `RESTRICT` → `restrict`, `CASCADE` → `cascade`, `SET NULL` → `setNull`, `SET DEFAULT` → `setDefault`
  - **Depends on:** TASK-012, TASK-013

---

## Phase 4: Migration Planner and DDL Emission

### 4.1 Planner — Emit ON DELETE / ON UPDATE clauses

- [ ] **TASK-015** (TDD) Write failing planner unit tests for referential action DDL
  - **File:** `packages/3-targets/3-targets/postgres/test/migrations/planner.referential-actions.test.ts` (new)
  - **Test matrix (see spec DDL expectations table):**
    - `undefined`/`undefined` → no clauses
    - `cascade`/`undefined` → `ON DELETE CASCADE` only
    - `restrict`/`undefined` → `ON DELETE RESTRICT` only
    - `setNull`/`undefined` → `ON DELETE SET NULL` only
    - `setDefault`/`undefined` → `ON DELETE SET DEFAULT` only
    - `noAction`/`undefined` → `ON DELETE NO ACTION` only
    - `undefined`/`cascade` → `ON UPDATE CASCADE` only
    - `cascade`/`cascade` → both clauses
  - **Assert:** `execute.sql` contains expected substrings

- [ ] **TASK-016** Extend `buildForeignKeyOperations()` to append referential action clauses
  - **File:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
  - **Actions:** After `REFERENCES ... (cols)` append `ON DELETE <action>` and/or `ON UPDATE <action>` when present
  - **Mapping:** `noAction` → `NO ACTION`, `restrict` → `RESTRICT`, `cascade` → `CASCADE`, `setNull` → `SET NULL`, `setDefault` → `SET DEFAULT`
  - **Depends on:** TASK-015

---

## Phase 5: Schema Verification

### 5.1 Verify helpers — Compare referential actions

- [ ] **TASK-017** (TDD) Write failing tests for FK verification with referential actions
  - **File:** `packages/2-sql/3-tooling/family/test/schema-verify.constraints.test.ts` (or new `schema-verify.referential-actions.test.ts`)
  - **Test:** Contract FK with `onDelete: 'cascade'` vs schema FK with `onDelete: 'cascade'` → pass
  - **Test:** Contract FK with `onDelete: 'cascade'` vs schema FK with `onDelete: 'restrict'` → fail with appropriate issue

- [ ] **TASK-018** Extend `verifyForeignKeys()` to compare `onDelete`/`onUpdate` when present
  - **File:** `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-helpers.ts`
  - **Actions:** When `matchingFK` found, compare `onDelete` and `onUpdate`; push `foreign_key_mismatch` if differing
  - **Depends on:** TASK-017

---

## Phase 6: Semantic Validation (Risks)

### 6.1 Validation — setNull on non-nullable column

- [ ] **TASK-019** (TDD) Write failing test: contract with `onDelete: 'setNull'` and non-nullable FK column fails validation
  - **File:** Contract or family validation tests
  - **Scope:** Semantic validation (can be in contract validation or migration planner pre-check)

- [ ] **TASK-020** Add semantic validation: reject `setNull` when FK column is `NOT NULL`
  - **Location:** Contract validation layer or planner `classifySchema` / verify step
  - **Depends on:** TASK-019

### 6.2 Validation — setDefault with invalid default (optional)

- [ ] **TASK-021** (TDD) Write failing test: `onDelete: 'setDefault'` when FK column has no default fails validation
  - **Scope:** Optional hardening; spec mentions ensuring default exists and type-matches

- [ ] **TASK-022** Add semantic validation for `setDefault` when applicable
  - **Depends on:** TASK-021

---

## Phase 7: Integration Tests

### 7.1 Planner integration

- [ ] **TASK-023** Add integration test: planner with referential actions produces executable DDL
  - **File:** `packages/3-targets/3-targets/postgres/test/migrations/planner.integration.test.ts` (or new file)
  - **Scope:** Run planner with contract containing `onDelete`/`onUpdate`, execute plan, verify schema

### 7.2 Schema verify integration

- [ ] **TASK-024** Add integration test: contract with referential actions verifies against introspected schema
  - **File:** `packages/3-targets/3-targets/postgres/test/migrations/schema-verify.after-runner.integration.test.ts` or dedicated file
  - **Setup:** Apply migration with `ON DELETE CASCADE`, introspect, verify contract matches

---

## Phase 8: E2E Tests — DDL and Behavior

### 8.1 E2E helpers and fixtures

- [ ] **TASK-025** Create shared fixture for user/post schema with parameterized referential action
  - **File:** `packages/3-targets/3-targets/postgres/test/migrations/e2e/referential-actions-fixtures.ts` (or under `test/`)
  - **Helper:** `createUserPostContract(onDelete?: ReferentialAction, onUpdate?: ReferentialAction)` → contract with user table, post table, FK with specified actions
  - **Helper:** `applyMigration(driver, contract)`, `insertTestData(driver, ...)`, `deleteParent(driver, table, id)`, `assertChildState(driver, expected)`

### 8.2 E2E — DDL assertions

- [ ] **TASK-026** E2E test: migration plan `execute.sql` contains expected `ON DELETE`/`ON UPDATE` clauses
  - **File:** E2E test file for referential actions
  - **Assert:** Plan operations for FKs include correct DDL fragments
  - **Depends on:** TASK-025

### 8.3 E2E — Behavior assertions (test.each matrix)

- [ ] **TASK-027** E2E `test.each` matrix: verify runtime behavior per action
  - **File:** `packages/3-targets/3-targets/postgres/test/migrations/referential-actions.e2e.test.ts` (or under `test/`)
  - **Matrix:**

| ID | Action | Fixture notes | Expected outcome |
|----|--------|---------------|------------------|
| cascade | `onDelete: 'cascade'` | user + 2 posts | Deleting user removes both posts |
| restrict | `onDelete: 'restrict'` | user + 2 posts | Deleting user fails with FK violation |
| setNull | `onDelete: 'setNull'` | user + post, nullable `userId` | Deleting user sets `post.userId` to NULL |
| setDefault | `onDelete: 'setDefault'` | user + post, default on `userId` | Deleting user sets `post.userId` to default |
| noAction | `onDelete: 'noAction'` | user + 2 posts | Deleting user fails (same as RESTRICT) |
| updateCascade | `onUpdate: 'cascade'` | category + post | Updating `category.id` cascades to `post.categoryId` |

  - **Naming:** `test.each([...])('$action results in $outcome', async ({ action, outcome }) => { ... })`
  - **Depends on:** TASK-025, TASK-026

### 8.4 E2E — DRY assertion helpers

- [ ] **TASK-028** Implement DRY helpers for E2E behavior assertions
  - **Helpers:** `expectChildRowsRemoved(driver, table, parentId)`, `expectParentDeleteFails(driver, table, id)`, `expectChildFkSetToNull(driver, table, column, parentId)`, `expectChildFkSetToDefault(driver, table, column, parentId)`, `expectUpdateCascades(driver, parentTable, childTable, ...)`

---

## Phase 9: Documentation and Cross-Target Notes

### 9.1 Spec and architecture

- [ ] **TASK-029** Update spec with cross-target notes (SQLite, SQL Server)
  - **File:** `agent-os/specs/2026-02-20-postgres-referential-actions/spec.md`
  - **Content:** Current limitations, future approach (native DDL), explicit note that emulation is deferred; legacy Prisma emulation had bugs

### 9.2 Package READMEs

- [ ] **TASK-030** Update `packages/3-targets/3-targets/postgres/README.md` with referential actions support
- [ ] **TASK-031** Update `packages/2-sql/3-tooling/family/README.md` if schema verification changes affect it
- [ ] **TASK-032** Add architecture note in `docs/architecture docs/` if design decisions warrant (e.g. ADR or subsystem doc update)

---

## Phase 10: Final Validation and Rollout

### 10.1 Typecheck and test suites

- [ ] **TASK-033** Run full typecheck: `pnpm typecheck`
- [ ] **TASK-034** Run package tests: `pnpm test:packages`
- [ ] **TASK-035** Run integration tests: `pnpm test:integration`
- [ ] **TASK-036** Run E2E tests: `pnpm test:e2e`
- [ ] **TASK-037** Run lint/deps: `pnpm lint:deps`

### 10.2 Rollout checklist

- [ ] **TASK-038** Verify no breaking changes to existing contracts (new fields optional)
- [ ] **TASK-039** Confirm dependency: `plans/feat-configurable-foreign-key-constraints-and-indexes` is merged/applied
- [ ] **TASK-040** Final review against acceptance criteria in spec

---

## Task Dependency Graph (Summary)

```
Phase 1: TASK-001 → TASK-002,003 → TASK-004,005 → TASK-006,007
Phase 2: TASK-009 → TASK-010 → TASK-011
Phase 3: TASK-012 → TASK-013 → TASK-014
Phase 4: TASK-015 → TASK-016
Phase 5: TASK-017 → TASK-018
Phase 6: TASK-019 → TASK-020; TASK-021 → TASK-022
Phase 7: TASK-023, TASK-024 (after planner + verify changes)
Phase 8: TASK-025 → TASK-026,027,028
Phase 9: TASK-029,030,031,032
Phase 10: TASK-033..040
```

---

## Quick Reference — Key Files

| Area | Package | Key Files |
|------|---------|-----------|
| Contract IR | `@prisma-next/sql-contract` | `types.ts`, `factories.ts`, `validators.ts` |
| Builder | `@prisma-next/contract-authoring` | `table-builder.ts`, `builder-state.ts` |
| Canonicalization | `@prisma-next/migration-control-plane` | `canonicalization.ts` |
| Schema IR | `@prisma-next/sql-schema-ir` | `types.ts` |
| Planner | `@prisma-next/target-postgres` | `planner.ts` |
| Control adapter | `@prisma-next/adapter-postgres` | `control-adapter.ts` |
| Verify | `@prisma-next/family-sql` | `verify-helpers.ts` |
