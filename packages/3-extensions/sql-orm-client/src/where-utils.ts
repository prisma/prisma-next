import {
  AndExpr,
  type AnyWhereExpr,
  type BoundWhereExpr,
} from '@prisma-next/sql-relational-core/ast';

export function createBoundWhereExpr(expr: AnyWhereExpr): BoundWhereExpr {
  return { expr };
}

export function isBoundWhereExpr(value: BoundWhereExpr | AnyWhereExpr): value is BoundWhereExpr {
  return typeof value === 'object' && value !== null && 'expr' in value && !('accept' in value);
}

export function ensureBoundWhereExpr(value: BoundWhereExpr | AnyWhereExpr): BoundWhereExpr {
  return isBoundWhereExpr(value) ? value : createBoundWhereExpr(value);
}

export function combineWhereFilters(
  filters: readonly BoundWhereExpr[],
): BoundWhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  const [firstFilter] = filters;
  if (filters.length === 1 && firstFilter !== undefined) {
    return firstFilter;
  }

  return {
    expr: AndExpr.of(filters.map((filter) => filter.expr)),
  };
}

export function combinePlainWhereExprs(filters: readonly AnyWhereExpr[]): AnyWhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return AndExpr.of(filters);
}
