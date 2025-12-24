import type {
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  AnyExpressionBuilder,
} from '@prisma-next/sql-relational-core/types';
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

export function isOperationExpr(
  expr: ColumnRef | OperationExpr | null | undefined,
): expr is OperationExpr {
  return expr != null && expr.kind === 'operation';
}

/**
 * Type predicate to check if a value is an ExpressionBuilder.
 */
export function isExpressionBuilder(value: unknown): value is AnyExpressionBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'expression'
  );
}

/**
 * Extracts the expression from a ColumnBuilder or ExpressionBuilder.
 * Returns the underlying ColumnRef or OperationExpr.
 */
export function extractExpression(
  builder: AnyColumnBuilder | AnyExpressionBuilder,
): ColumnRef | OperationExpr {
  if (isExpressionBuilder(builder)) {
    return builder.expr;
  }
  // It's a ColumnBuilder - convert to ColumnRef
  const colBuilder = builder as { table: string; column: string };
  return {
    kind: 'col',
    table: colBuilder.table,
    column: colBuilder.column,
  };
}

export function getColumnInfo(expr: AnyColumnBuilder | AnyExpressionBuilder): {
  table: string;
  column: string;
} {
  if (isExpressionBuilder(expr)) {
    const baseCol = extractBaseColumnRef(expr.expr);
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
