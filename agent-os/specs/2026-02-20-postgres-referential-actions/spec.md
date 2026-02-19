# Spec: Postgres Referential Actions

**Date:** 2026-02-20  
**Status:** Draft  
**Depends on:** [feat-configurable-foreign-key-constraints-and-indexes](../../../plans/feat-configurable-foreign-key-constraints-and-indexes.md)

---

## Summary

Add Postgres-specific referential actions (`ON DELETE` and `ON UPDATE`) as a follow-up to configurable foreign keys and indexes. Foreign keys in the contract IR gain optional `onDelete` and `onUpdate` fields. The migration planner emits the corresponding DDL clauses for Postgres; no emulation or cross-target support in this increment.

---

## Context

### Prerequisites

- **Configurable FK plan** (`plans/feat-configurable-foreign-key-constraints-and-indexes.md`) adds:
  - Per-FK `constraint`, `index`, `indexName` plus global `foreignKeys.constraints` / `foreignKeys.indexes`
  - `.foreignKey(columns, references, options?)` builder with optional config

- **Contract IR** (`packages/2-sql/1-core/contract/src/types.ts`): `ForeignKey` currently has `columns`, `references`, `name` (and optionally `constraint`, `index`, `indexName` once the FK config plan lands).

- **ADR 044** reserves `foreignKeyMatches(table, columns[], refTable, refColumns[], onDelete?, onUpdate?)` for post-check vocabulary.

### Problem

There is no way to express referential actions in the contract. Generated DDL omits `ON DELETE` and `ON UPDATE`; the database therefore uses defaults (`NO ACTION` / `RESTRICT` semantics). Users cannot express intent for CASCADE, SET NULL, or other actions.

---

## Goals

1. Extend contract IR and builder with `onDelete` and `onUpdate` referential action options.
2. Emit correct Postgres DDL (`ON DELETE ...`, `ON UPDATE ...`) from the migration planner.
3. Verify emitted DDL and runtime behavior via exhaustive tests (unit + e2e).
4. Document cross-target limitations and deferred emulation.

---

## Non-Goals

- **Emulation for unsupported targets:** No runtime emulation of referential actions for SQLite, SQL Server, or others.
- **Cross-target DDL emission:** Only Postgres DDL is emitted; other targets are out of scope.
- **PSL authoring:** PSL changes (if any) are deferred to a separate effort.
- **Change existing FKs:** Altering referential actions on existing FKs (e.g. via `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...`) is future work; this spec focuses on new FK creation.

---

## API / IR Changes

### Contract IR

Extend `ForeignKey` in `packages/2-sql/1-core/contract/src/types.ts`:

```typescript
export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  // ... existing constraint/index/indexName from FK config plan
};
```

`ReferentialAction` values map directly to Postgres keywords (case-normalized).

### Builder API

Extend `.foreignKey()` options in `packages/1-framework/2-authoring/contract/src/table-builder.ts`:

```typescript
.foreignKey(
  ['userId'],
  { table: 'user', columns: ['id'] },
  {
    name: 'post_userId_fkey',
    onDelete: 'cascade',
    onUpdate: 'noAction',
  }
)
```

When omitted, both default to `undefined` (Postgres default: `NO ACTION`).

### Canonicalization

Include `onDelete` and `onUpdate` in deterministic canonicalization (`packages/1-framework/1-core/migration/control-plane/src/emission/canonicalization.ts`). Omitted fields must not affect hash when equivalent to default.

---

## Migration and Postgres Target Changes

### Planner

**File:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`

In `buildForeignKeyOperations()`, extend the `execute.sql` string to append referential action clauses when present:

```sql
ALTER TABLE "schema"."child_table"
ADD CONSTRAINT "child_table_parentId_fkey"
FOREIGN KEY ("parentId")
REFERENCES "schema"."parent_table" ("id")
ON DELETE CASCADE
ON UPDATE NO ACTION
```

### Generated DDL Expectations

| Contract `onDelete` | Contract `onUpdate` | Generated DDL (append) |
|---|---|---|
| `undefined` | `undefined` | *(none)* |
| `cascade` | `undefined` | `ON DELETE CASCADE` |
| `restrict` | `undefined` | `ON DELETE RESTRICT` |
| `setNull` | `undefined` | `ON DELETE SET NULL` |
| `setDefault` | `undefined` | `ON DELETE SET DEFAULT` |
| `noAction` | `undefined` | `ON DELETE NO ACTION` |
| `undefined` | `cascade` | `ON UPDATE CASCADE` |
| `cascade` | `cascade` | `ON DELETE CASCADE ON UPDATE CASCADE` |
| *(any)* | *(any)* | Both clauses when both specified |

### Post-check / Verification

- Extend `foreignKeyMatches` post-check (or equivalent) to include `onDelete` and `onUpdate` in the params when present.
- Schema verification (`verify-helpers.ts`) should compare introspected referential actions against contract when the Postgres adapter introspects FK metadata (e.g. `information_schema.referential_constraints` or `pg_constraint`).

### Introspection

Postgres control adapter must read `ON DELETE` and `ON UPDATE` from `information_schema.referential_constraints` (`delete_rule`, `update_rule`) and populate the schema IR for verification and round-trip.

---

## Testing Strategy

### TDD Discipline

- **Red-green-refactor:** Write failing tests first; implement until green; refactor.
- **Behavior-first:** Test expected outcomes, not implementation details.

### Unit Tests

| Package | Scope |
|---------|-------|
| `@prisma-next/sql-contract` | `fk()` factory with `onDelete`/`onUpdate`; validator accepts new fields |
| `@prisma-next/contract` (table-builder) | `.foreignKey()` with `onDelete`/`onUpdate` options |
| `@prisma-next/target-postgres` | Planner emits correct DDL for each `ReferentialAction` combination |

### Integration Tests

- Planner: each supported `onDelete` and `onUpdate` value produces the correct SQL fragment.
- Schema verify: contract with referential actions verifies against introspected schema.

### E2E Tests

E2E tests must verify:

1. **Generated DDL:** The migration plan’s `execute.sql` contains the expected `ON DELETE` / `ON UPDATE` clauses.
2. **Runtime behavior:** Applying the migration and then exercising the actions (e.g. `DELETE` on parent) produces the expected outcome.

### Test Matrix (Referential Actions)

| Parent role | Child role | Action | Expected outcome |
|-------------|------------|--------|------------------|
| `user` (1 row) | `post` (2 rows, FK→user) | `ON DELETE CASCADE` | Deleting user removes both posts |
| `user` (1 row) | `post` (2 rows, FK→user) | `ON DELETE RESTRICT` | Deleting user fails with FK violation |
| `user` (1 row) | `post` (2 rows, FK→user, nullable) | `ON DELETE SET NULL` | Deleting user sets `post.userId` to NULL |
| `user` (1 row) | `post` (1 row, FK→user, default) | `ON DELETE SET DEFAULT` | Deleting user sets `post.userId` to default |
| `user` (1 row) | `post` (2 rows, FK→user) | `ON DELETE NO ACTION` | Deleting user fails (same as RESTRICT) |
| `category` (1 row) | `post` (1 row, FK→category) | `ON UPDATE CASCADE` | Updating category.id cascades to post.categoryId |

Use `test.each([...])` with descriptive names such as:

```typescript
test.each([
  { action: 'cascade', outcome: 'childRowsRemoved' },
  { action: 'restrict', outcome: 'parentDeleteFails' },
  { action: 'setNull', outcome: 'childFkSetToNull' },
  // ...
])('$action results in $outcome', async ({ action, outcome }) => { ... });
```

### DRY and Readability

- Shared fixture for user/post schema with parameterized referential action.
- Helper to apply migration, insert test data, perform action (e.g. `DELETE FROM user WHERE id = $1`), assert expected state.

---

## Acceptance Criteria

- [ ] `ForeignKey` IR type includes optional `onDelete` and `onUpdate` of type `ReferentialAction`.
- [ ] `.foreignKey()` builder accepts `onDelete` and `onUpdate` in options.
- [ ] Postgres planner emits `ON DELETE <action>` and `ON UPDATE <action>` in DDL when specified.
- [ ] Unit tests cover all `ReferentialAction` values for both builder and planner.
- [ ] E2E tests verify generated DDL contains correct clauses.
- [ ] E2E tests verify runtime behavior: CASCADE removes children; RESTRICT blocks delete; SET NULL nullifies FK; SET DEFAULT applies default.
- [ ] Introspection populates referential actions; schema verification compares them.
- [ ] Spec includes cross-target notes (SQLite, SQL Server) and deferred emulation.

---

## Risks

| Risk | Mitigation |
|------|-------------|
| Breaking existing contracts | New fields are optional; default behavior unchanged |
| SET NULL on non-nullable column | Validation: reject `setNull` when FK column is `NOT NULL` |
| SET DEFAULT with invalid default | Validation: ensure default exists and type-matches referenced column |

---

## Cross-Target Notes

### SQLite

- **Current:** No implementation. SQLite supports `ON DELETE` / `ON UPDATE` in its FK syntax, but `PRAGMA foreign_keys` must be enabled; behavior differs from Postgres in edge cases.
- **Future:** Native DDL support is feasible (SQLite 3.6.19+). Emulation is not planned; legacy Prisma attempted emulation and it had bugs.

### SQL Server

- **Current:** No implementation. SQL Server supports `ON DELETE` / `ON UPDATE` with similar semantics.
- **Future:** Native DDL support is the intended path. No emulation in scope.

### Legacy Prisma Context

Previous Prisma ORM versions attempted runtime emulation of referential actions when FK constraints were disabled. That approach was buggy (e.g. inconsistent behavior with raw SQL, multi-step deletes). Prisma Next defers emulation; referential actions are expressed in DDL and enforced by the database.

---

## References

- **Plans:** `plans/feat-configurable-foreign-key-constraints-and-indexes.md`
- **ADRs:** ADR 044 (Pre/post check vocabulary), ADR 009 (Naming), ADR 028 (Migration operations)
- **Packages:**
  - `packages/2-sql/1-core/contract` — ForeignKey type, `fk()` factory, validators
  - `packages/1-framework/2-authoring/contract` — table-builder `.foreignKey()`
  - `packages/3-targets/3-targets/postgres` — planner, runner
  - `packages/3-targets/6-adapters/postgres` — control adapter, introspection
- **External:** [PostgreSQL 18: Constraints (FK section)](https://www.postgresql.org/docs/current/ddl-constraints.html)
