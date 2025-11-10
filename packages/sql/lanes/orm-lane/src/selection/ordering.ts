import type { AnyOrderBuilder, OrderBuilder } from '@prisma-next/sql-relational-core/types';
import type { ColumnRef, OperationExpr, StorageColumn } from '@prisma-next/sql-target';
import { createColumnRef, createOrderByItem } from '../utils/ast';
import { extractBaseColumnRef, isOperationExpr } from '../utils/guards';

export function buildOrderByClause(orderBy: AnyOrderBuilder | undefined):
  | ReadonlyArray<{
      expr: ColumnRef | OperationExpr;
      dir: import('@prisma-next/sql-target').Direction;
    }>
  | undefined {
  if (!orderBy) {
    return undefined;
  }

  const orderByBuilder = orderBy as OrderBuilder<string, StorageColumn, unknown>;
  const orderExpr = orderByBuilder.expr;
  const expr: ColumnRef | OperationExpr = isOperationExpr(orderExpr)
    ? orderExpr
    : (() => {
        const colBuilder = orderExpr as { table: string; column: string };
        return createColumnRef(colBuilder.table, colBuilder.column);
      })();
  return [createOrderByItem(expr, orderByBuilder.dir)];
}

export function buildChildOrderByClause(orderBy: AnyOrderBuilder | undefined):
  | ReadonlyArray<{
      expr: ColumnRef | OperationExpr;
      dir: import('@prisma-next/sql-target').Direction;
    }>
  | undefined {
  if (!orderBy) {
    return undefined;
  }

  const orderByBuilder = orderBy as OrderBuilder<string, StorageColumn, unknown>;
  const orderExpr = orderByBuilder.expr;
  const expr: ColumnRef | OperationExpr = (() => {
    if (isOperationExpr(orderExpr)) {
      const baseCol = extractBaseColumnRef(orderExpr);
      return createColumnRef(baseCol.table, baseCol.column);
    }
    const colBuilder = orderExpr as { table: string; column: string };
    return createColumnRef(colBuilder.table, colBuilder.column);
  })();
  return [createOrderByItem(expr, orderByBuilder.dir)];
}
