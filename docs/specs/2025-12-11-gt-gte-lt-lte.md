# Comparison Operators (gt, gte, lt, lte) — Implementation Spec

**Author:** Claude (implementation assist)  
**Date:** 2025-12-11  
**Status:** Draft  
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

## 2. Current State Analysis

### 2.1 What's Implemented (Commits a2d86f81, b804c1ec)

| Area | File | Status | Notes |
|------|------|--------|-------|
| **AST Types** | `relational-core/src/ast/types.ts` | ✅ Done | Extended `BinaryExpr.op` union |
| **Builder Types** | `relational-core/src/types.ts` | ✅ Done | Extended `ColumnBuilder` interface, `BinaryBuilder.op` |
| **Column Implementation** | `relational-core/src/schema.ts` | ⚠️ Needs refactor | Methods work but have code duplication |
| **Operations Registry** | `relational-core/src/operations-registry.ts` | ⚠️ Needs refactor | Methods work but have code duplication |
| **AST Factory** | `relational-core/src/ast/predicate.ts` | ⚠️ Needs refactor | Operator type duplicated |
| **Predicate Builder (SQL)** | `sql-lane/src/sql/predicate-builder.ts` | ✅ Done | Uses `where.op` dynamically |
| **Predicate Builder (ORM)** | `orm-lane/src/selection/predicates.ts` | ✅ Done | Uses `where.op` dynamically |
| **Postgres Adapter** | `postgres-adapter/src/core/adapter.ts` | ✅ Done | `operatorMap` translates to SQL |
| **Unit Tests** | `relational-core/test/schema.test.ts` | ⚠️ Review | Tests exist but quality concerns |
| **Integration Tests** | `sql-lane/test/sql.test.ts` | ✅ Done | AST structure verified |
| **Adapter Tests** | `postgres-adapter/test/adapter.test.ts` | ✅ Done | SQL rendering verified |
| **Example Code** | `examples/prisma-next-demo/src/queries/orm-pagination.ts` | ❌ Not executable | Functions exist but not wired |

### 2.2 PR Review Comments to Address

1. **DRY up `BinaryOp` type** — The operator union `'eq' | 'gt' | 'lt' | 'gte' | 'lte'` is repeated in:
   - `relational-core/src/ast/types.ts` (L48: `BinaryExpr.op`)
   - `relational-core/src/ast/predicate.ts` (L11: function parameter)
   - `relational-core/src/types.ts` (L68: `BinaryBuilder.op`)
   
2. **DRY up `ColumnBuilderImpl` methods** — The `gt`/`lt`/`gte`/`lte` methods in `schema.ts` (L79-133) are nearly identical to `eq`, differing only in the `op` value.

3. **DRY up `operations-registry.ts` methods** — Same duplication pattern in `executeOperation` (L146-177).

4. **Test assertion has conditional** — Test at `schema.test.ts:279` has a condition in the expectation (needs investigation).

5. **Example not executable** — `orm-pagination.ts` functions are not wired into the demo app.

---

## 3. Implementation Plan

### Phase 1: Extract `BinaryOp` Type (DRY)

**Goal:** Single source of truth for binary operator types.

#### 3.1.1 Create shared type in `ast/types.ts`

```prisma-next/packages/sql/lanes/relational-core/src/ast/types.ts
// Add near top of file, before BinaryExpr
export type BinaryOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte';

export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: BinaryOp;  // Changed from inline union
  readonly left: ColumnRef | OperationExpr;
  readonly right: ParamRef;
}
```

#### 3.1.2 Update `predicate.ts` to import `BinaryOp`

```prisma-next/packages/sql/lanes/relational-core/src/ast/predicate.ts
import type { BinaryOp, ... } from './types';

export function createBinaryExpr(
  op: BinaryOp,  // Changed from inline union
  left: ColumnRef | OperationExpr,
  right: ParamRef,
): BinaryExpr { ... }
```

#### 3.1.3 Update `types.ts` to import `BinaryOp`

```prisma-next/packages/sql/lanes/relational-core/src/types.ts
import type { BinaryOp, OperationExpr } from './ast/types';

export interface BinaryBuilder<...> {
  readonly kind: 'binary';
  readonly op: BinaryOp;  // Changed from inline union
  readonly left: ColumnBuilder<...> | OperationExpr;
  readonly right: ParamPlaceholder;
}
```

#### 3.1.4 Export `BinaryOp` from package entrypoints

Ensure `BinaryOp` is exported from:
- `relational-core/src/ast/index.ts` (or barrel file)
- `relational-core/src/types.ts` re-export

**Files to modify:**
- `packages/sql/lanes/relational-core/src/ast/types.ts`
- `packages/sql/lanes/relational-core/src/ast/predicate.ts`
- `packages/sql/lanes/relational-core/src/types.ts`

---

### Phase 2: DRY up `ColumnBuilderImpl` in `schema.ts`

**Goal:** Extract helper method for binary builder creation.

#### 3.2.1 Add private helper method

```prisma-next/packages/sql/lanes/relational-core/src/schema.ts
export class ColumnBuilderImpl<...> {
  // ... existing code ...

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

  eq(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('eq', value);
  }

  gt(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('gt', value);
  }

  lt(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('lt', value);
  }

  gte(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('gte', value);
  }

  lte(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('lte', value);
  }
}
```

**Files to modify:**
- `packages/sql/lanes/relational-core/src/schema.ts`

---

### Phase 3: DRY up `operations-registry.ts`

**Goal:** Extract helper for binary method creation in operation results.

#### 3.3.1 Extract helper function in `executeOperation`

```prisma-next/packages/sql/lanes/relational-core/src/operations-registry.ts
function executeOperation(...) {
  // ... existing setup code ...

  const createComparisonMethod = (op: BinaryOp) => (value: ParamPlaceholder) =>
    Object.freeze({
      kind: 'binary' as const,
      op,
      left: operationExpr,
      right: value,
    });

  const baseResult = {
    kind: 'column' as const,
    table: selfBuilderWithExpr.table,
    column: selfBuilderWithExpr.column,
    get columnMeta() { return returnColumnMeta; },
    eq: createComparisonMethod('eq'),
    gt: createComparisonMethod('gt'),
    lt: createComparisonMethod('lt'),
    gte: createComparisonMethod('gte'),
    lte: createComparisonMethod('lte'),
    asc() { /* ... */ },
    desc() { /* ... */ },
    _operationExpr: operationExpr,
  } as unknown as AnyColumnBuilder & { _operationExpr?: OperationExpr };

  // ... rest of function ...
}
```

**Files to modify:**
- `packages/sql/lanes/relational-core/src/operations-registry.ts`

---

### Phase 4: Review and Fix Tests

**Goal:** Ensure tests are idiomatic and properly cover the feature.

#### 3.4.1 Audit `schema.test.ts`

Current tests in `schema.test.ts` for the operators:
- `column builder gt creates binary builder` (L270-287)
- `column builder lt creates binary builder` (L289-306)
- `column builder gte creates binary builder` (L308-325)
- `column builder lte creates binary builder` (L327-344)
- Error tests for invalid params (L346-379)

**Review items:**
1. **Fix conditional in expectation** (review comment at line 279): The tests use a pattern like:
   ```typescript
   expect({
     defined: binary !== undefined,  // <-- This is the "condition"
     kind: binary.kind,
     op: binary.op,
   }).toMatchObject({
     defined: true,
     kind: 'binary',
     op: 'gt',
   });
   ```
   This is unusual—the `defined: binary !== undefined` evaluates a boolean inside the object literal. **Recommendation:** Either use `expect(binary).toBeDefined()` as a separate assertion, or simply trust that accessing `.kind` and `.op` would throw if `binary` were undefined. Cleaner approach:
   ```typescript
   expect(binary).toMatchObject({
     kind: 'binary',
     op: 'gt',
   });
   ```
2. Ensure test isolation (each test creates fresh context)
3. Consider consolidating repetitive tests into parameterized tests using `it.each`

#### 3.4.2 Consider parameterized tests

```typescript
// Example consolidation
describe('comparison operators', () => {
  const operators = ['eq', 'gt', 'lt', 'gte', 'lte'] as const;
  
  it.each(operators)('%s creates binary builder with correct op', (op) => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const idColumn = tables.user.columns.id;

    const method = idColumn[op] as (p: ParamPlaceholder) => BinaryBuilder;
    const binary = method(param('value'));
    
    expect(binary).toMatchObject({
      kind: 'binary',
      op,
    });
  });

  it.each(operators)('%s throws for invalid param', (op) => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const idColumn = tables.user.columns.id;

    const method = idColumn[op] as (p: unknown) => unknown;
    expect(() => method({ kind: 'invalid' })).toThrow(
      'Parameter placeholder required for column comparison'
    );
  });
});
```

**Decision:** Use parameterized tests to consolidate the repetitive operator tests. This reduces duplication and makes the test suite easier to maintain.

**Files to modify:**
- `packages/sql/lanes/relational-core/test/schema.test.ts`

---

### Phase 5: Wire Pagination Example into Demo App

**Goal:** Make `orm-pagination.ts` functions executable via the demo CLI.

#### 3.5.1 Add CLI Commands

The demo app (`examples/prisma-next-demo/src/main.ts`) uses a simple command dispatch pattern. Add new commands for pagination:

```typescript
// In main.ts, add imports:
import {
  ormGetUsersByIdCursor,
  ormGetUsersByTimestampCursor,
  ormGetUsersBackward,
  ormGetUsersFirstPage,
  ormGetUsersNextPage,
} from './queries/orm-pagination';

// Add command handlers:
} else if (cmd === 'users-paginate') {
  const [cursorStr, limitStr] = args;
  const cursor = cursorStr ? Number.parseInt(cursorStr, 10) : null;
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
  const users = await ormGetUsersByIdCursor(cursor, limit, runtime);
  console.log(JSON.stringify(users, null, 2));
} else if (cmd === 'users-paginate-back') {
  const [cursorStr, limitStr] = args;
  if (!cursorStr) {
    console.error('Usage: pnpm start -- users-paginate-back <cursor> [limit]');
    process.exit(1);
  }
  const cursor = Number.parseInt(cursorStr, 10);
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
  const users = await ormGetUsersBackward(cursor, limit, runtime);
  console.log(JSON.stringify(users, null, 2));
}
```

#### 3.5.2 Update `orm-pagination.ts`

The current functions take a `runtime` parameter but the demo uses a singleton pattern. Update to match demo conventions:

```typescript
// Import the shared runtime
import { runtime } from '../prisma/runtime';

// Update function signatures to use shared runtime (or keep param for flexibility)
export async function ormGetUsersByIdCursor(
  cursor: number | null,
  pageSize: number,
) {
  // Use imported runtime instead of parameter
}
```

Alternatively, keep the `runtime` parameter and pass the singleton from `main.ts`.

#### 3.5.3 Update Usage Help

Update the help message in `main.ts`:

```typescript
console.log(
  'Usage: pnpm start -- [users [limit] | user <userId> | posts <userId> | ' +
  'users-with-posts [limit] | users-paginate [cursor] [limit] | ' +
  'users-paginate-back <cursor> [limit] | similarity-search <queryVector> [limit] | ' +
  'budget-violation]',
);
```

**Files to modify:**
- `examples/prisma-next-demo/src/main.ts`
- `examples/prisma-next-demo/src/queries/orm-pagination.ts`

---

### Phase 6: Verify Other Adapters (If Any)

**Goal:** Ensure all adapters support the new operators.

Currently only `postgres-adapter` exists. The `operatorMap` approach is correct:

```typescript
const operatorMap: Record<BinaryExpr['op'], string> = {
  eq: '=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};
```

**Action:** No changes needed unless other adapters exist. The implementation in `renderBinary()` is clean.

---

### Phase 7: Add Integration/E2E Tests Against Real Database

**Goal:** Verify comparison operators work correctly against a real PostgreSQL database.

Currently there are **no integration or e2e tests** that execute queries with `gt`/`lt`/`gte`/`lte` against a real database. The existing tests only verify:
- Unit tests: AST structure is correct
- Adapter tests: SQL string rendering is correct

But we need to verify the full round-trip actually works.

#### 3.7.1 Add Integration Test

Add tests to `test/integration/test/runtime.integration.test.ts` or create a new file `test/integration/test/comparison-operators.integration.test.ts`:

```typescript
import { param } from '@prisma-next/sql-relational-core/param';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';

describe('comparison operators integration', () => {
  // Use existing test setup pattern from runtime.integration.test.ts
  
  beforeEach(async () => {
    await setupTestDatabase(client, fixtureContract, async (c) => {
      await c.query('drop table if exists "user"');
      await c.query('create table "user" (id serial primary key, email text not null)');
      // Insert 10 users with sequential IDs
      for (let i = 1; i <= 10; i++) {
        await c.query('insert into "user" (email) values ($1)', [`user${i}@example.com`]);
      }
    });
  });

  it('gt operator returns rows where id > cursor', async () => {
    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const plan = sql({ context })
      .from(tables.user)
      .select({ id: tables.user.columns.id, email: tables.user.columns.email })
      .where(tables.user.columns.id.gt(param('cursor')))
      .orderBy(tables.user.columns.id.asc())
      .build({ params: { cursor: 5 } });

    const rows = await executePlanAndCollect(runtime, plan);
    
    expect(rows.length).toBe(5); // IDs 6, 7, 8, 9, 10
    expect(rows.every(r => r.id > 5)).toBe(true);
  });

  it('lt operator returns rows where id < cursor', async () => {
    // Similar test for lt
  });

  it('gte operator returns rows where id >= cursor', async () => {
    // Similar test for gte  
  });

  it('lte operator returns rows where id <= cursor', async () => {
    // Similar test for lte
  });

  it('cursor pagination returns correct pages', async () => {
    // Test full pagination flow: first page, then next page using last ID
  });
});
```

#### 3.7.2 Add E2E Test

Add to `test/e2e/framework/test/runtime.basic.test.ts` or create new file:

```typescript
it('cursor pagination with gt operator works end-to-end', async () => {
  // Full e2e test including contract emission and runtime execution
});
```

**Files to modify/create:**
- `test/integration/test/comparison-operators.integration.test.ts` (new file)
- OR extend `test/integration/test/runtime.integration.test.ts`

---

## 4. File Change Summary

| File | Action | Priority |
|------|--------|----------|
| `relational-core/src/ast/types.ts` | Add `BinaryOp` type export | High |
| `relational-core/src/ast/predicate.ts` | Import `BinaryOp` | High |
| `relational-core/src/types.ts` | Import `BinaryOp` | High |
| `relational-core/src/schema.ts` | Extract `createBinaryBuilder` helper | High |
| `relational-core/src/operations-registry.ts` | Extract `createComparisonMethod` helper | High |
| `relational-core/test/schema.test.ts` | Refactor to parameterized tests | High |
| `examples/prisma-next-demo/src/main.ts` | Add pagination CLI commands | High |
| `examples/prisma-next-demo/src/queries/orm-pagination.ts` | Wire into demo runtime | High |
| `test/integration/test/comparison-operators.integration.test.ts` | New integration tests | High |

---

## 5. Testing Checklist

After implementation, verify:

- [ ] `pnpm build` passes
- [ ] `pnpm test:packages` passes
- [ ] `pnpm lint:deps` passes (no import violations)
- [ ] Type exports are accessible from package entrypoints
- [ ] No regressions in existing `eq` operator behavior
- [ ] Integration tests pass against real PostgreSQL
- [ ] Demo pagination commands work (`pnpm start -- users-paginate`)

### 5.1 Manual Verification Queries

```typescript
// SQL Lane
const plan1 = sql
  .from(tables.user)
  .where(tables.user.columns.id.gt(param('cursor')))
  .select({ id: tables.user.columns.id })
  .build({ params: { cursor: 100 } });

// Expected AST where clause:
// { kind: 'bin', op: 'gt', left: { kind: 'col', ... }, right: { kind: 'param', ... } }

// ORM Lane
const plan2 = orm
  .user()
  .where((u) => u.createdAt.lte(param('cutoff')))
  .findMany({ params: { cutoff: new Date() } });
```

---

## 6. Open Questions

1. **Should we add compound comparisons?** (e.g., `between(min, max)` as sugar for `gte(min).and(lte(max))`)
   - **Answer:** Out of scope for this PR. File separate feature request.

2. **Type safety on comparisons?** Currently all operators work on all scalar types.
   - **Answer:** Keep current behavior. SQL databases handle type compatibility at runtime. Adding TypeScript restrictions would be overly complex for limited benefit.

3. **NULL handling?** `col.gt(null)` behavior?
   - **Answer:** Current implementation requires `ParamPlaceholder`. Literal NULL comparisons would need different syntax (e.g., `isNull()`/`isNotNull()`). Out of scope.

---

## 7. Implementation Order

Execute phases in order:

1. **Phase 1** — Extract `BinaryOp` type (enables cleaner subsequent changes)
2. **Phase 2** — DRY `ColumnBuilderImpl` 
3. **Phase 3** — DRY `operations-registry.ts`
4. **Phase 4** — Refactor to parameterized tests
5. **Phase 5** — Wire pagination example into demo app
6. **Phase 6** — Verify adapters (should be no-op)
7. **Phase 7** — Add integration/e2e tests against real database

Estimated effort: ~4-5 hours for clean implementation with all tests passing.

---

## 8. Appendix: Current Code Snippets

### A. Current `BinaryExpr` definition (ast/types.ts:46-52)

```typescript
export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  readonly left: ColumnRef | OperationExpr;
  readonly right: ParamRef;
}
```

### B. Current `createBinaryExpr` (ast/predicate.ts:10-19)

```typescript
export function createBinaryExpr(
  op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte',
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

### C. Current `BinaryBuilder` definition (types.ts:62-71)

```typescript
export interface BinaryBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'binary';
  readonly op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  readonly left: ColumnBuilder<ColumnName, ColumnMeta, JsType> | OperationExpr;
  readonly right: ParamPlaceholder;
}
```

### D. Current `renderBinary` operator map (postgres-adapter:142-149)

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

## 9. Success Criteria

- [ ] All PR review comments addressed
- [ ] No code duplication for operator type
- [ ] Helper methods extract common logic
- [ ] All unit tests pass
- [ ] Integration tests pass against real PostgreSQL
- [ ] Build succeeds
- [ ] Demo pagination commands work end-to-end
