import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import type { ColumnRef, LiteralExpr, OperationExpr, ParamRef } from '@prisma-next/sql-target';

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
