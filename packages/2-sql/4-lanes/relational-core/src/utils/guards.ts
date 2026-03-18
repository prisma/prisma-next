import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { type ExpressionSource, OperationExpr } from '../ast/types';
import type {
  AnyColumnBuilder,
  AnyExpressionSource,
  ExpressionBuilder,
  ParamPlaceholder,
  ValueSource,
} from '../types';

/**
 * Helper to extract columnMeta from a ColumnBuilder or ExpressionBuilder.
 * Returns StorageColumn if present, undefined otherwise.
 * Both ColumnBuilder and ExpressionBuilder have columnMeta property.
 */
export function getColumnMeta(expr: AnyExpressionSource): StorageColumn | undefined {
  // Both ColumnBuilder and ExpressionBuilder have columnMeta: StorageColumn
  // TypeScript should narrow the type after the 'in' check
  if ('columnMeta' in expr) {
    return expr.columnMeta;
  }
  return undefined;
}

/**
 * Type predicate to check if a value is a ParamPlaceholder.
 */
export function isParamPlaceholder(value: unknown): value is ParamPlaceholder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'param-placeholder' &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

/**
 * Helper to extract table and column from a ColumnBuilder, ExpressionBuilder, or OperationExpr.
 * For ExpressionBuilder or OperationExpr, recursively unwraps to find the base ColumnRef.
 */
export function getColumnInfo(expr: AnyExpressionSource | OperationExpr): {
  table: string;
  column: string;
} {
  if (expr instanceof OperationExpr) {
    const baseCol = expr.baseColumnRef();
    return { table: baseCol.table, column: baseCol.column };
  }
  if (isExpressionBuilder(expr)) {
    const baseCol = expr.expr.baseColumnRef();
    return { table: baseCol.table, column: baseCol.column };
  }
  // expr is ColumnBuilder - TypeScript can't narrow properly
  const colBuilder = expr as unknown as { table: string; column: string };
  return { table: colBuilder.table, column: colBuilder.column };
}

/**
 * Type predicate to check if a value is a ColumnBuilder.
 */
export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

/**
 * Type predicate to check if a value is an ExpressionBuilder.
 */
export function isExpressionBuilder(value: unknown): value is ExpressionBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'expression'
  );
}

/**
 * Type predicate to check if a value is an ExpressionSource (has toExpr method).
 */
export function isExpressionSource(value: unknown): value is ExpressionSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toExpr' in value &&
    typeof (value as ExpressionSource).toExpr === 'function'
  );
}

/**
 * Type predicate to check if a value is a ValueSource.
 * ValueSource is either a ParamPlaceholder or an ExpressionSource.
 */
export function isValueSource(value: unknown): value is ValueSource {
  return isParamPlaceholder(value) || isExpressionSource(value);
}
