import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { ColumnRef, Direction, OperationExpr } from '@prisma-next/sql-relational-core/ast';
import type { AnyOrderBuilder, OrderBuilder } from '@prisma-next/sql-relational-core/types';
import { createOrderByItem } from '../utils/ast';
import { extractExpression } from '../utils/guards';

export function buildOrderByClause(orderBy: AnyOrderBuilder | undefined):
  | ReadonlyArray<{
      expr: ColumnRef | OperationExpr;
      dir: Direction;
    }>
  | undefined {
  if (!orderBy) {
    return undefined;
  }

  const orderByBuilder = orderBy as OrderBuilder<string, StorageColumn, unknown>;
  const expr = extractExpression(orderByBuilder.expr);
  return [createOrderByItem(expr, orderByBuilder.dir)];
}

export function buildChildOrderByClause(orderBy: AnyOrderBuilder | undefined):
  | ReadonlyArray<{
      expr: ColumnRef | OperationExpr;
      dir: Direction;
    }>
  | undefined {
  if (!orderBy) {
    return undefined;
  }

  const orderByBuilder = orderBy as OrderBuilder<string, StorageColumn, unknown>;
  const expr = extractExpression(orderByBuilder.expr);
  return [createOrderByItem(expr, orderByBuilder.dir)];
}
