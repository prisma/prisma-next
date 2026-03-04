import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { BoundWhereExpr, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { createAndExpr, mapExpressionDeep } from '@prisma-next/sql-relational-core/ast';

export function createBoundWhereExpr(expr: WhereExpr): BoundWhereExpr {
  return {
    expr,
    params: [],
    paramDescriptors: [],
  };
}

export function isBoundWhereExpr(value: BoundWhereExpr | WhereExpr): value is BoundWhereExpr {
  return typeof value === 'object' && value !== null && 'expr' in value && 'params' in value;
}

export function ensureBoundWhereExpr(value: BoundWhereExpr | WhereExpr): BoundWhereExpr {
  return isBoundWhereExpr(value) ? value : createBoundWhereExpr(value);
}

function offsetParamDescriptors(
  descriptors: readonly ParamDescriptor[],
  offset: number,
): ReadonlyArray<ParamDescriptor> {
  return descriptors.map((descriptor, index) => ({
    ...descriptor,
    index: offset + index + 1,
  }));
}

function offsetWhereExprParams(expr: WhereExpr, offset: number): WhereExpr {
  if (offset === 0) {
    return expr;
  }

  return mapExpressionDeep({
    param: (param) => ({
      ...param,
      index: param.index + offset,
    }),
    listLiteral: (list) => ({
      ...list,
      values: list.values.map((value) =>
        value.kind === 'param' ? { ...value, index: value.index + offset } : value,
      ),
    }),
  }).where(expr);
}

export function offsetBoundWhereExpr(bound: BoundWhereExpr, offset: number): BoundWhereExpr {
  if (offset === 0) {
    return {
      expr: bound.expr,
      params: [...bound.params],
      paramDescriptors: offsetParamDescriptors(bound.paramDescriptors, 0),
    };
  }

  return {
    expr: offsetWhereExprParams(bound.expr, offset),
    params: [...bound.params],
    paramDescriptors: offsetParamDescriptors(bound.paramDescriptors, offset),
  };
}

export function combineWhereFilters(
  filters: readonly BoundWhereExpr[],
): BoundWhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  const shiftedFilters: BoundWhereExpr[] = [];
  let offset = 0;

  for (const filter of filters) {
    const shifted = offsetBoundWhereExpr(filter, offset);
    shiftedFilters.push(shifted);
    offset += filter.params.length;
  }

  const [firstFilter] = shiftedFilters;
  if (shiftedFilters.length === 1 && firstFilter !== undefined) {
    return firstFilter;
  }

  return {
    expr: createAndExpr(shiftedFilters.map((filter) => filter.expr)),
    params: shiftedFilters.flatMap((filter) => filter.params),
    paramDescriptors: shiftedFilters.flatMap((filter) => filter.paramDescriptors),
  };
}

export function combinePlainWhereExprs(filters: readonly WhereExpr[]): WhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return createAndExpr(filters);
}
