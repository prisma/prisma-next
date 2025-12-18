import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type { AnyColumnBuilder, ParamPlaceholder } from '@prisma-next/sql-relational-core/types';

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

export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
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
