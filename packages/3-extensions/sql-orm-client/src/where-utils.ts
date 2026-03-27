import type { ParamDescriptor } from '@prisma-next/contract/types';
import {
  AndExpr,
  type AnyWhereExpr,
  type BoundWhereExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';

export function createBoundWhereExpr(expr: AnyWhereExpr): BoundWhereExpr {
  return {
    expr,
    params: [],
    paramDescriptors: [],
  };
}

export function isBoundWhereExpr(value: BoundWhereExpr | AnyWhereExpr): value is BoundWhereExpr {
  return typeof value === 'object' && value !== null && 'expr' in value && 'params' in value;
}

export function ensureBoundWhereExpr(value: BoundWhereExpr | AnyWhereExpr): BoundWhereExpr {
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

function offsetWhereExprParams(expr: AnyWhereExpr, offset: number): AnyWhereExpr {
  if (offset === 0) {
    return expr;
  }

  return expr.rewrite({
    paramRef: (param) => new ParamRef(param.index + offset, param.name),
  });
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
    expr: AndExpr.of(shiftedFilters.map((filter) => filter.expr)),
    params: shiftedFilters.flatMap((filter) => filter.params),
    paramDescriptors: shiftedFilters.flatMap((filter) => filter.paramDescriptors),
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
