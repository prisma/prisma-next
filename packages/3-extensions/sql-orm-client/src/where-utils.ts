import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { createAndExpr } from '@prisma-next/sql-relational-core/ast';

export function combineWhereFilters(filters: readonly WhereExpr[]): WhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  const firstFilter = filters[0];
  if (filters.length === 1 && firstFilter !== undefined) {
    return firstFilter;
  }

  return createAndExpr([...filters]);
}
