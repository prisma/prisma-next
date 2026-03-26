import { AndExpr, type WhereExpr } from '@prisma-next/sql-relational-core/ast';

export function combineWhereExprs(filters: readonly WhereExpr[]): WhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return AndExpr.of(filters);
}
