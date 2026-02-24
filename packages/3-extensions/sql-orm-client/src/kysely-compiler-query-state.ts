import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { ExpressionBuilder } from 'kysely';
import type { AnyDB, AnySelectQueryBuilder } from './kysely-compiler-shared';
import { combineWhereFilters, whereExprToKysely } from './kysely-compiler-where';

export function applyWhereFilters<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  filters: readonly WhereExpr[],
): QueryBuilder {
  const whereExpr = combineWhereFilters(filters);
  if (!whereExpr) {
    return qb;
  }

  return qb.where((eb) =>
    whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr),
  ) as QueryBuilder;
}

export function applyProjection<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  selectedFields: readonly string[] | undefined,
): QueryBuilder {
  if (!selectedFields || selectedFields.length === 0) {
    return qb.selectAll() as QueryBuilder;
  }

  const qualified = selectedFields.map((column) => `${tableName}.${column}`);
  return qb.select(qualified) as QueryBuilder;
}

export function applyDistinct<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  distinct: readonly string[] | undefined,
  distinctOn: readonly string[] | undefined,
): QueryBuilder {
  if (distinctOn && distinctOn.length > 0) {
    const qualified = distinctOn.map((column) => `${tableName}.${column}`);
    return qb.distinctOn(qualified) as QueryBuilder;
  }

  if (distinct && distinct.length > 0) {
    return qb.distinct() as QueryBuilder;
  }

  return qb;
}
