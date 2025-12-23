import type {
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { getColumnMeta, isParamPlaceholder } from '@prisma-next/sql-relational-core/utils/guards';

export { getColumnMeta, isParamPlaceholder };

export function extractBaseColumnRef(expr: ColumnRef | OperationExpr): ColumnRef {
  if (expr.kind === 'col') {
    return expr;
  }
  return extractBaseColumnRef(expr.self);
}

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

export function isOperationExpr(expr: AnyColumnBuilder | OperationExpr): expr is OperationExpr {
  return typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'operation';
}

/**
 * Helper to extract operation expression from builder.
 * Returns OperationExpr if present, undefined otherwise.
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

export function getColumnInfo(expr: AnyColumnBuilder | OperationExpr): {
  table: string;
  column: string;
} {
  if (isOperationExpr(expr)) {
    const baseCol = extractBaseColumnRef(expr);
    return { table: baseCol.table, column: baseCol.column };
  }
  const colBuilder = expr as unknown as { table: string; column: string };
  return { table: colBuilder.table, column: colBuilder.column };
}

export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}
