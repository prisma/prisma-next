import { AndExpr, type AnyWhereExpr } from '@prisma-next/sql-relational-core/ast';

export function combineWhereExprs(filters: readonly AnyWhereExpr[]): AnyWhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return AndExpr.of(filters);
}
