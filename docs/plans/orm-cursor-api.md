# ORM Cursor API Implementation Plan

## Overview

Add a cursor-based pagination API to the ORM lane. Cursor uses a separate `CursorBuilder` type (not `BinaryBuilder`) that only exposes `gt/lt/gte/lte` operations (no chaining).

## API Design

```typescript
orm
  .post()
  .cursor((u) => lastPost !== undefined ? u.id.cursor.gt(param('lastId')) : undefined)
  .take(10)
  .findMany({ params: { lastId: 42 } })
```

**Key Points:**
- `cursor()` accepts a function returning `CursorPredicate | undefined`
- `CursorPredicate` is a separate type (not `BinaryBuilder`)
- `CursorBuilder` only exposes `gt/lt/gte/lte` (no `eq`, no `and/or` chaining)
- When a `CursorPredicate` is returned:
  1. Append predicate to WHERE clause with AND
  2. Auto-generate ORDER BY:
     - `gt` or `gte` → `column ASC`
     - `lt` or `lte` → `column DESC`

## Implementation Steps

### 1. Create CursorBuilder and CursorPredicate Types

**File**: `packages/sql/lanes/orm-lane/src/orm-types.ts` (or new `cursor-types.ts`)

**Create `CursorBuilder` interface:**
```typescript
export interface CursorBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'cursor-builder';
  readonly column: ColumnBuilder<ColumnName, ColumnMeta, JsType>;
  gt(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType>;
  lt(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType>;
  gte(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType>;
  lte(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType>;
  // NO eq, and, or methods
}
```

**Create `CursorPredicate` interface:**
```typescript
export interface CursorPredicate<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'cursor-predicate';
  readonly op: 'gt' | 'lt' | 'gte' | 'lte';
  readonly column: ColumnBuilder<ColumnName, ColumnMeta, JsType>;
  readonly param: ParamPlaceholder;
  // NO and/or methods - cannot be chained
}
```

**Create helper alias:**
```typescript
export type AnyCursorPredicate = CursorPredicate<string, StorageColumn, unknown>;
```

### 2. Create CursorBuilder Factory

**File**: `packages/sql/lanes/orm-lane/src/selection/cursor.ts` (new file)

**Function to create CursorBuilder from ColumnBuilder:**
```typescript
export function createCursorBuilder<ColumnName extends string, ColumnMeta extends StorageColumn, JsType>(
  column: ColumnBuilder<ColumnName, ColumnMeta, JsType>,
): CursorBuilder<ColumnName, ColumnMeta, JsType>
```

**Implementation:**
- Return an object with `kind: 'cursor-builder'`
- Store the column builder
- Implement `gt/lt/gte/lte` methods that return `CursorPredicate` objects
- Each method creates a `CursorPredicate` with `kind: 'cursor-predicate'`, `op`, `column`, and `param`

### 3. Add Cursor Accessor to ModelColumnAccessor

**File**: `packages/sql/lanes/orm-lane/src/orm-types.ts`

**Option A: Add `.cursor` property to each column**
Modify `ModelColumnAccessor` to include a `cursor` property on each column that returns a `CursorBuilder`:
```typescript
export type ModelColumnAccessor<...> = {
  readonly [K in keyof Fields & string]: ColumnBuilder<...> & {
    cursor: CursorBuilder<...>;
  };
}
```

**Option B: Create separate CursorModelAccessor type**
Create a parallel type that wraps columns with `CursorBuilder`:
```typescript
export type CursorModelAccessor<...> = {
  readonly [K in keyof Fields & string]: CursorBuilder<...>;
}
```

**Decision**: Use Option A (add `.cursor` property) so users can access both regular column operations and cursor operations from the same model accessor.

### 4. Expose Cursor Accessor in Builder

**File**: `packages/sql/lanes/orm-lane/src/orm/builder.ts`

**Add method to get cursor model accessor:**
```typescript
private _getCursorModelAccessor(): CursorModelAccessor<TContract, CodecTypes, ModelName>
```

**Implementation:**
- Similar to `_getModelAccessor()` but wraps each column with `createCursorBuilder()`
- Returns an object where each field is a `CursorBuilder` instead of `ColumnBuilder`

### 5. Add Cursor State to Builder

**File**: `packages/sql/lanes/orm-lane/src/orm/builder.ts`
- Add `cursorPredicate: AnyCursorPredicate | undefined` field to `OrmModelBuilderImpl`
- Initialize to `undefined` in constructor

### 6. Add Cursor Method to Interface

**File**: `packages/sql/lanes/orm-lane/src/orm-types.ts`

```typescript
cursor(
  fn: (model: CursorModelAccessor<TContract, CodecTypes, ModelName>) => AnyCursorPredicate | undefined,
): OrmModelBuilder<TContract, CodecTypes, ModelName, Includes, Row>;
```

**File**: `packages/sql/lanes/orm-lane/src/orm/builder.ts`
- Implement `cursor()` method (immutable pattern)
- Call function with cursor model accessor
- Store result in `cursorPredicate` field

### 7. Convert CursorPredicate to BinaryBuilder for WHERE

**File**: `packages/sql/lanes/orm-lane/src/selection/cursor.ts`

**Function to convert CursorPredicate to BinaryBuilder:**
```typescript
export function cursorPredicateToBinaryBuilder(
  cursorPredicate: AnyCursorPredicate,
): AnyBinaryBuilder
```

**Implementation:**
- Extract `column`, `op`, and `param` from `CursorPredicate`
- Call the corresponding method on the column builder (`column.gt(param)`, etc.)
- Return the `BinaryBuilder` (which can then be used with existing `buildWhereExpr()`)

### 8. Build ORDER BY from CursorPredicate

**File**: `packages/sql/lanes/orm-lane/src/selection/cursor.ts`

**Function to build ORDER BY from cursor:**
```typescript
export function buildCursorOrderBy(
  cursorPredicate: AnyCursorPredicate,
): AnyOrderBuilder
```

**Implementation:**
- Extract `column` and `op` from `CursorPredicate`
- Based on `op`:
  - `'gt'` or `'gte'` → `column.asc()`
  - `'lt'` or `'lte'` → `column.desc()`
- Return `OrderBuilder`

### 9. Integrate in findMany()

**File**: `packages/sql/lanes/orm-lane/src/orm/builder.ts`

Modify `findMany()`:
- After building existing WHERE clause, check if `cursorPredicate` is defined
- If defined:
  1. Convert `CursorPredicate` to `BinaryBuilder` using `cursorPredicateToBinaryBuilder()`
  2. Build WHERE predicate from the `BinaryBuilder` using `buildWhereExpr()`
  3. Combine with existing WHERE using `combineWhereClauses()` (AND)
  4. Build ORDER BY from cursor using `buildCursorOrderBy()`
  5. Set `orderByExpr` to cursor ORDER BY (overrides existing if any)

**Integration point:**
```typescript
// Build where clause
const whereResult = this.wherePredicate
  ? buildWhereExpr(this.wherePredicate, this.contract, paramsMap, paramDescriptors, paramValues)
  : undefined;
let finalWhereExpr = whereResult?.expr;

// Build cursor predicate if cursorPredicate is defined
if (this.cursorPredicate) {
  const cursorBinary = cursorPredicateToBinaryBuilder(this.cursorPredicate);
  const cursorWhereResult = buildWhereExpr(
    cursorBinary,
    this.contract,
    paramsMap,
    paramDescriptors,
    paramValues,
  );
  if (cursorWhereResult) {
    finalWhereExpr = combineWhereClauses(finalWhereExpr, [cursorWhereResult.expr]);
  }
  
  // Auto-generate ORDER BY from cursor
  const cursorOrderBy = buildCursorOrderBy(this.cursorPredicate);
  this.orderByExpr = cursorOrderBy;
}

// Build orderBy clause (now includes cursor ORDER BY)
const orderByClause = buildOrderByClause(this.orderByExpr);
```

### 10. Add Tests

**File**: `packages/sql/lanes/orm-lane/test/orm.cursor.test.ts` (new file)

Test cases:
1. **Basic cursor with gt**: `cursor((u) => u.id.cursor.gt(param('lastId')))` → WHERE `id > lastId`, ORDER BY `id ASC`
2. **Basic cursor with gte**: `cursor((u) => u.id.cursor.gte(param('lastId')))` → WHERE `id >= lastId`, ORDER BY `id ASC`
3. **Basic cursor with lt**: `cursor((u) => u.id.cursor.lt(param('lastId')))` → WHERE `id < lastId`, ORDER BY `id DESC`
4. **Basic cursor with lte**: `cursor((u) => u.id.cursor.lte(param('lastId')))` → WHERE `id <= lastId`, ORDER BY `id DESC`
5. **Cursor with undefined**: no WHERE clause added, no ORDER BY added
6. **Cursor combined with existing WHERE**: combines with AND
7. **Cursor overrides orderBy**: if both are set, cursor ORDER BY takes precedence
8. **CursorBuilder has no eq method**: TypeScript error if trying to use `eq()`
9. **CursorPredicate has no and/or methods**: TypeScript error if trying to chain
10. **Cursor with operation expression**: handles `OperationExpr` in column (if supported)

### 11. Update Documentation

**File**: `packages/sql/lanes/orm-lane/README.md`
- Add cursor pagination section
- Show usage examples with `.cursor` property
- Explain that cursor auto-generates ORDER BY
- Document that `CursorBuilder` only supports `gt/lt/gte/lte` (no `eq`, no chaining)
- Explain that cursor ORDER BY overrides explicit `orderBy()`

## Files to Modify/Create

1. `packages/sql/lanes/orm-lane/src/orm-types.ts` - Add `CursorBuilder`, `CursorPredicate`, `CursorModelAccessor` types and `cursor()` method
2. `packages/sql/lanes/orm-lane/src/orm/builder.ts` - Add cursor state, cursor model accessor, method implementation, and integration
3. `packages/sql/lanes/orm-lane/src/selection/cursor.ts` - New file for cursor utilities (factory, conversion, ORDER BY building)
4. `packages/sql/lanes/orm-lane/test/orm.cursor.test.ts` - New test file
5. `packages/sql/lanes/orm-lane/README.md` - Update documentation

## Dependencies

- Uses existing `buildWhereExpr()` from `selection/predicates.ts`
- Uses existing `combineWhereClauses()` from `relations/include-plan.ts`
- Uses existing `buildOrderByClause()` from `selection/ordering.ts`
- Uses existing `ColumnBuilder` from `@prisma-next/sql-relational-core/types`

## Notes

- `CursorBuilder` is a separate type from `BinaryBuilder` - no chaining allowed
- `CursorPredicate` is a separate type from `BinaryBuilder` - cannot be combined with `and/or`
- Cursor pagination is more efficient than offset/limit for large datasets
- Cursor values should be unique and stable (typically primary keys or timestamps)
- The cursor parameter must be provided in `build()` options
- Cursor automatically generates ORDER BY to ensure consistent ordering
- Cursor ORDER BY overrides explicit `orderBy()` if both are set

## Future Enhancements

1. **Multi-field cursors**: Support composite cursors (e.g., `(createdAt, id)`)
2. **Cursor validation**: Ensure cursor column is indexed or unique
3. **Combine cursor and orderBy**: Allow combining cursor ORDER BY with additional ordering
