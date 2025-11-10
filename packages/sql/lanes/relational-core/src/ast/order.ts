import type { ColumnRef, Direction, OperationExpr } from '@prisma-next/sql-target';

export function createOrderByItem(
  expr: ColumnRef | OperationExpr,
  dir: 'asc' | 'desc',
): { expr: ColumnRef | OperationExpr; dir: Direction } {
  return {
    expr,
    dir,
  };
}
