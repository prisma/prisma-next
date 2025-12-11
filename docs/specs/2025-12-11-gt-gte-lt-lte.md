# Comparison Operators (gt, gte, lt, lte) — Implementation Spec

**Author:** Claude (implementation assist)  
**Date:** 2025-12-11  
**Status:** ✅ Complete  
**PR Branch:** Contains commits `a2d86f81` (original) and `b804c1ec` (CI coverage tests)

---

## 1. Overview

This spec documents the implementation of comparison operators (`gt`, `lt`, `gte`, `lte`) for the SQL query builder, enabling cursor-based pagination and range queries. These operators complement the existing `eq` operator.

### 1.1 Use Cases

- **Cursor-based pagination:** `WHERE id > :lastId ORDER BY id ASC LIMIT 10`
- **Range queries:** `WHERE price >= :min AND price <= :max`
- **Timestamp filtering:** `WHERE createdAt < :cutoff`

### 1.2 Scope

- SQL Lane: `tables.user.columns.id.gt(param('cursor'))`
- ORM Lane: `.where((u) => u.id.gt(param('cursor')))`
- Operation expressions: `col.someOp().gt(param('value'))`

---

## 2. Implementation Status

### 2.1 Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Extract `BinaryOp` Type (DRY) | ✅ Complete |
| Phase 2 | DRY up `ColumnBuilderImpl` in `schema.ts` | ✅ Complete |
| Phase 3 | DRY up `operations-registry.ts` | ✅ Complete |
| Phase 4 | Review and Fix Tests | ✅ Complete |
| Phase 5 | Wire Pagination Example into Demo App | ✅ Complete |
| Phase 6 | Verify Other Adapters | ✅ Complete |
| Phase 7 | Add Integration/E2E Tests | ✅ Complete |

### 2.2 Detailed Status by Area

| Area | File | Status | Notes |
|------|------|--------|-------|
| **AST Types** | `relational-core/src/ast/types.ts` | ✅ Done | `BinaryOp` type extracted and exported (L45) |
| **Builder Types** | `relational-core/src/types.ts` | ✅ Done | Imports `BinaryOp` from `./ast/types` (L10) |
| **Column Implementation** | `relational-core/src/schema.ts` | ✅ Done | `createBinaryBuilder` helper method (L63-76) |
| **Operations Registry** | `relational-core/src/operations-registry.ts` | ✅ Done | `createComparisonMethod` helper (L129-133) |
| **AST Factory** | `relational-core/src/ast/predicate.ts` | ✅ Done | Imports `BinaryOp` from `./types` (L3) |
| **Predicate Builder (SQL)** | `sql-lane/src/sql/predicate-builder.ts` | ✅ Done | Uses `where.op` dynamically |
| **Predicate Builder (ORM)** | `orm-lane/src/selection/predicates.ts` | ✅ Done | Uses `where.op` dynamically |
| **Postgres Adapter** | `postgres-adapter/src/core/adapter.ts` | ✅ Done | `operatorMap` translates to SQL |
| **Unit Tests** | `relational-core/test/schema.test.ts` | ✅ Done | Parameterized `it.each` tests (L240-270) |
| **Integration Tests** | `test/integration/test/comparison-operators.integration.test.ts` | ✅ Done | Full coverage with real PostgreSQL |
| **Adapter Tests** | `postgres-adapter/test/adapter.test.ts` | ✅ Done | SQL rendering verified |
| **Example Code** | `examples/prisma-next-demo/src/queries/orm-pagination.ts` | ✅ Done | Functions implemented and exported |
| **Demo CLI** | `examples/prisma-next-demo/src/main.ts` | ✅ Done | `users-paginate` and `users-paginate-back` commands wired |

---

## 3. Implementation Details (Completed)

### Phase 1: Extract `BinaryOp` Type (DRY) ✅

**Goal:** Single source of truth for binary operator types.

**Implementation:**
- `BinaryOp` type defined in `relational-core/src/ast/types.ts:45`:
  ```typescript
  export type BinaryOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  ```
- `predicate.ts` imports `BinaryOp` from `./types` (L1-9)
- `types.ts` imports `BinaryOp` from `./ast/types` (L9-16)

---

### Phase 2: DRY up `ColumnBuilderImpl` in `schema.ts` ✅

**Goal:** Extract helper method for binary builder creation.

**Implementation:** Private `createBinaryBuilder` method at L63-76:
```typescript
private createBinaryBuilder(
  op: BinaryOp,
  value: ParamPlaceholder,
): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
  if (value.kind !== 'param-placeholder') {
    throw planInvalid('Parameter placeholder required for column comparison');
  }
  return Object.freeze({
    kind: 'binary' as const,
    op,
    left: this as unknown as ColumnBuilder<ColumnName, ColumnMeta, JsType>,
    right: value,
  }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
}
```

All comparison methods (`eq`, `gt`, `lt`, `gte`, `lte`) now delegate to this helper.

---

### Phase 3: DRY up `operations-registry.ts` ✅

**Goal:** Extract helper for binary method creation in operation results.

**Implementation:** `createComparisonMethod` helper at L129-137:
```typescript
const createComparisonMethod = (op: BinaryOp) => (value: ParamPlaceholder) =>
  Object.freeze({
    kind: 'binary' as const,
    op,
    left: operationExpr,
    right: value,
  });
```

All comparison methods in `baseResult` now use this helper (L145-149).

---

### Phase 4: Review and Fix Tests ✅

**Goal:** Ensure tests are idiomatic and properly cover the feature.

**Implementation:** Parameterized tests using `it.each` at L240-270:
```typescript
describe('comparison operators', () => {
  const operators: BinaryOp[] = ['eq', 'gt', 'lt', 'gte', 'lte'];

  it.each(operators)('%s creates binary builder with correct op', (op) => {
    // ... test implementation
    expect(binary).toMatchObject({
      kind: 'binary',
      op,
    });
  });

  it.each(operators)('%s throws for invalid param', (op) => {
    // ... test implementation
  });
});
```

The conditional assertion pattern (`defined: binary !== undefined`) has been removed in favor of clean `toMatchObject` assertions.

---

### Phase 5: Wire Pagination Example into Demo App ✅

**Goal:** Make `orm-pagination.ts` functions executable via the demo CLI.

**Implementation:**
- `orm-pagination.ts` exports:
  - `ormGetUsersByIdCursor(cursor, pageSize, runtime)`
  - `ormGetUsersByTimestampCursor(cursor, pageSize, runtime)`
  - `ormGetUsersBackward(cursor, pageSize, runtime)`
  - `ormGetUsersFirstPage(pageSize, runtime)`
  - `ormGetUsersNextPage(lastId, pageSize, runtime)`

- `main.ts` CLI commands (L62-79):
  - `users-paginate [cursor] [limit]` - Forward pagination
  - `users-paginate-back <cursor> [limit]` - Backward pagination

- Help text updated (L95-98)

---

### Phase 6: Verify Other Adapters ✅

**Goal:** Ensure all adapters support the new operators.

**Result:** Only `postgres-adapter` exists. The `operatorMap` correctly maps all operators:
```typescript
const operatorMap: Record<BinaryExpr['op'], string> = {
  eq: '=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};
```

---

### Phase 7: Add Integration/E2E Tests Against Real Database ✅

**Goal:** Verify comparison operators work correctly against a real PostgreSQL database.

**Implementation:** `test/integration/test/comparison-operators.integration.test.ts` with tests:
- `gt operator returns rows where id > cursor`
- `lt operator returns rows where id < cursor`
- `gte operator returns rows where id >= cursor`
- `lte operator returns rows where id <= cursor`
- `cursor pagination returns correct pages (forward)`
- `cursor pagination returns correct pages (backward)`
- `gt returns empty result when cursor exceeds all values`
- `lt returns empty result when cursor is below all values`

---

## 4. Testing Checklist

- [x] `pnpm build` passes
- [x] `pnpm test:packages` passes
- [x] `pnpm lint:deps` passes (no import violations)
- [x] Type exports are accessible from package entrypoints
- [x] No regressions in existing `eq` operator behavior
- [x] Integration tests pass against real PostgreSQL
- [x] Demo pagination commands work (`pnpm start -- users-paginate`)

### Manual Verification Commands

```bash
# Run in examples/prisma-next-demo
pnpm start -- users-paginate           # First page (no cursor)
pnpm start -- users-paginate 5         # Page after id=5
pnpm start -- users-paginate 5 3       # 3 results after id=5
pnpm start -- users-paginate-back 10 5 # 5 results before id=10
```

---

## 5. Remaining Gaps / Areas for Improvement

### 5.1 Low Priority Improvements

| Item | Description | Priority |
|------|-------------|----------|
| **Compound comparisons** | Add `between(min, max)` as sugar for `gte(min).and(lte(max))` | Low - File separate feature request |
| **`neq` operator** | Add `neq` (not equal) operator | Low - File separate feature request |
| **NULL handling** | Support `isNull()` / `isNotNull()` predicates | Low - Different syntax needed |

### 5.2 Documentation Improvements

| Item | Description | Priority |
|------|-------------|----------|
| **API docs** | Add JSDoc to comparison methods in `ColumnBuilder` interface | Medium |
| **Usage guide** | Add pagination example to user-facing docs | Medium |

### 5.3 Test Coverage Opportunities

| Item | Description | Priority |
|------|-------------|----------|
| **ORM lane integration** | Add integration tests using ORM lane (not just SQL lane) | Medium |
| **Timestamp comparisons** | Add integration tests for `createdAt.lt(param('cutoff'))` patterns | Low |
| **Operation expression comparisons** | Test `col.someOp().gt(param('value'))` end-to-end | Medium |

---

## 6. Current Code References

### A. `BinaryOp` type (ast/types.ts:45)

```typescript
export type BinaryOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
```

### B. `BinaryExpr` interface (ast/types.ts:47-52)

```typescript
export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: BinaryOp;
  readonly left: ColumnRef | OperationExpr;
  readonly right: ParamRef;
}
```

### C. `createBinaryExpr` (ast/predicate.ts:11-21)

```typescript
export function createBinaryExpr(
  op: BinaryOp,
  left: ColumnRef | OperationExpr,
  right: ParamRef,
): BinaryExpr {
  return {
    kind: 'bin',
    op,
    left,
    right,
  };
}
```

### D. `BinaryBuilder` interface (types.ts:69-78)

```typescript
export interface BinaryBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'binary';
  readonly op: BinaryOp;
  readonly left: ColumnBuilder<ColumnName, ColumnMeta, JsType> | OperationExpr;
  readonly right: ParamPlaceholder;
}
```

### E. `operatorMap` (postgres-adapter renderBinary)

```typescript
const operatorMap: Record<BinaryExpr['op'], string> = {
  eq: '=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};
```

---

## 7. Success Criteria ✅

- [x] All PR review comments addressed
- [x] No code duplication for operator type
- [x] Helper methods extract common logic
- [x] All unit tests pass
- [x] Integration tests pass against real PostgreSQL
- [x] Build succeeds
- [x] Demo pagination commands work end-to-end

---

## 8. Conclusion

The comparison operators feature is **fully implemented and tested**. All planned phases have been completed:

1. ✅ DRY refactoring of `BinaryOp` type
2. ✅ Helper methods in `schema.ts` and `operations-registry.ts`
3. ✅ Parameterized unit tests
4. ✅ Demo app integration with CLI commands
5. ✅ Comprehensive integration tests against real PostgreSQL

The feature supports cursor-based pagination and range queries across both SQL and ORM lanes, with full type safety and clean, maintainable code.