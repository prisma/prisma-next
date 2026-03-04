import type { Expression, OrderByItem } from './types';

export function createOrderByItem(
  expr: Expression,
  dir: 'asc' | 'desc',
): OrderByItem {
  return {
    expr,
    dir,
  };
}
