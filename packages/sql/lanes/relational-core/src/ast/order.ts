import type { ColumnRef, Direction, OperationExpr } from './types';

export function createOrderByItem(
  expr: ColumnRef | OperationExpr,
  dir: 'asc' | 'desc',
): { expr: ColumnRef | OperationExpr; dir: Direction } {
  return {
    expr,
    dir,
  };
}
