import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { Direction } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyOrderBuilder,
  ColumnBuilder,
  OrderBuilder,
  ParamPlaceholder,
} from '@prisma-next/sql-relational-core/types';
import type {
  AnyCursorPredicate,
  CursorBuilder,
  CursorPredicate,
} from '../orm-types';

/**
 * Creates a CursorBuilder from a ColumnBuilder.
 * CursorBuilder only exposes gt/lt/gte/lte operations (no eq, no chaining).
 */
export function createCursorBuilder<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType,
>(
  column: ColumnBuilder<ColumnName, ColumnMeta, JsType>,
): CursorBuilder<ColumnName, ColumnMeta, JsType> {
  return {
    kind: 'cursor-builder',
    column,
    gt(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType> {
      return {
        kind: 'cursor-predicate',
        op: 'gt',
        column,
        param: value,
      };
    },
    lt(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType> {
      return {
        kind: 'cursor-predicate',
        op: 'lt',
        column,
        param: value,
      };
    },
    gte(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType> {
      return {
        kind: 'cursor-predicate',
        op: 'gte',
        column,
        param: value,
      };
    },
    lte(value: ParamPlaceholder): CursorPredicate<ColumnName, ColumnMeta, JsType> {
      return {
        kind: 'cursor-predicate',
        op: 'lte',
        column,
        param: value,
      };
    },
  };
}

/**
 * Converts a CursorPredicate to a BinaryBuilder for use with buildWhereExpr().
 */
export function cursorPredicateToBinaryBuilder(
  cursorPredicate: AnyCursorPredicate,
): AnyBinaryBuilder {
  const { column, op, param } = cursorPredicate;
  
  // Call the corresponding method on the column builder
  switch (op) {
    case 'gt':
      return column.gt(param);
    case 'lt':
      return column.lt(param);
    case 'gte':
      return column.gte(param);
    case 'lte':
      return column.lte(param);
  }
}

/**
 * Builds an ORDER BY clause from a CursorPredicate.
 * - gt or gte → column ASC
 * - lt or lte → column DESC
 */
export function buildCursorOrderBy(
  cursorPredicate: AnyCursorPredicate,
): AnyOrderBuilder {
  const { column, op } = cursorPredicate;
  
  // Determine direction based on operator
  const dir: Direction = op === 'gt' || op === 'gte' ? 'asc' : 'desc';
  
  // Create OrderBuilder
  const orderBuilder: OrderBuilder<string, StorageColumn, unknown> = {
    kind: 'order',
    expr: column as AnyColumnBuilder,
    dir,
  };
  
  return orderBuilder;
}
