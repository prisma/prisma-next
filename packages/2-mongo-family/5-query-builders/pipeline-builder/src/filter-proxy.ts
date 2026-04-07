import type { MongoFilterExpr } from '@prisma-next/mongo-query-ast';
import { MongoExistsExpr, MongoFieldFilter } from '@prisma-next/mongo-query-ast';
import type { MongoValue } from '@prisma-next/mongo-value';
import type { DocShape, FilterHandle, FilterProxy } from './types';

function createFilterHandle(field: string): FilterHandle {
  return {
    eq: (value: MongoValue): MongoFilterExpr => MongoFieldFilter.eq(field, value),
    ne: (value: MongoValue): MongoFilterExpr => MongoFieldFilter.neq(field, value),
    gt: (value: MongoValue): MongoFilterExpr => MongoFieldFilter.gt(field, value),
    gte: (value: MongoValue): MongoFilterExpr => MongoFieldFilter.gte(field, value),
    lt: (value: MongoValue): MongoFilterExpr => MongoFieldFilter.lt(field, value),
    lte: (value: MongoValue): MongoFilterExpr => MongoFieldFilter.lte(field, value),
    in: (values: ReadonlyArray<MongoValue>): MongoFilterExpr => MongoFieldFilter.in(field, values),
    exists: (flag?: boolean): MongoFilterExpr =>
      flag === false ? MongoExistsExpr.notExists(field) : MongoExistsExpr.exists(field),
  };
}

export function createFilterProxy<S extends DocShape>(): FilterProxy<S> {
  return new Proxy({} as FilterProxy<S>, {
    get(_target, prop: string | symbol): FilterHandle | undefined {
      if (typeof prop === 'symbol') return undefined;
      return createFilterHandle(prop);
    },
  });
}
