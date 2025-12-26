import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { ColumnRef, LiteralExpr, OperationExpr, ParamRef } from '../ast/types';
import type { AnyColumnBuilder, ParamPlaceholder } from '../types';

/**
 * Helper to extract columnMeta from a ColumnBuilder.
 * Returns StorageColumn if present, undefined otherwise.
 * AnyColumnBuilder is a union that includes types with columnMeta property,
 * so we can safely access it after checking for existence.
 */
export function getColumnMeta(expr: AnyColumnBuilder): StorageColumn | undefined {
  // AnyColumnBuilder includes AnyColumnBuilderBase which has columnMeta: StorageColumn
  // and ColumnBuilder which has columnMeta: ColumnMeta extends StorageColumn
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
 * Recursively extracts the base ColumnRef from an OperationExpr.
 * If the expression is already a ColumnRef, it is returned directly.
 */
export function extractBaseColumnRef(expr: ColumnRef | OperationExpr): ColumnRef {
  if (expr.kind === 'col') {
    return expr;
  }
  return extractBaseColumnRef(expr.self);
}

/**
 * Recursively collects all ColumnRef nodes from an expression tree.
 * Handles nested OperationExpr structures by traversing both self and args.
 */
export function collectColumnRefs(
  expr: ColumnRef | ParamRef | LiteralExpr | OperationExpr,
): ColumnRef[] {
  if (expr.kind === 'col') {
    return [expr];
  }
  if (expr.kind === 'operation') {
    const refs: ColumnRef[] = collectColumnRefs(expr.self);
    for (const arg of expr.args) {
      refs.push(...collectColumnRefs(arg));
    }
    return refs;
  }
  return [];
}

/**
 * Type predicate to check if an expression is an OperationExpr.
 */
export function isOperationExpr(expr: AnyColumnBuilder | OperationExpr): expr is OperationExpr {
  return typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'operation';
}

/**
 * Helper to extract table and column from a ColumnBuilder or OperationExpr.
 * For OperationExpr, recursively unwraps to find the base ColumnRef.
 */
export function getColumnInfo(expr: AnyColumnBuilder | OperationExpr): {
  table: string;
  column: string;
} {
  if (isOperationExpr(expr)) {
    const baseCol = extractBaseColumnRef(expr);
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
 * Extracts and returns an OperationExpr from a builder.
 * Returns the OperationExpr if the builder is an OperationExpr or has an _operationExpr property,
 * otherwise returns undefined.
 *
 * @design-note: This function accesses the hidden `_operationExpr` property, which is a code smell.
 * The issue is that `executeOperation()` in relational-core returns a ColumnBuilder-shaped object
 * with a hidden `_operationExpr` property, creating coupling between lanes and relational-core
 * implementation details. A cleaner design would be to have operation results be a separate
 * type (e.g., `OperationResultBuilder`) that properly represents expression nodes rather than
 * pretending to be a ColumnBuilder. This would require refactoring the operation execution
 * system in relational-core to return proper expression types.
 */
export function getOperationExpr(
  builder: AnyColumnBuilder | OperationExpr,
): OperationExpr | undefined {
  if (isOperationExpr(builder)) {
    return builder;
  }
  const builderWithExpr = builder as unknown as { _operationExpr?: OperationExpr };
  return builderWithExpr._operationExpr;
}
