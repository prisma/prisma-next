import {
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  type ExistsExpr,
  LiteralExpr,
  NullCheckExpr,
  ParamRef,
  type ToWhereExpr,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { all, and, not, or } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { normalizeWhereArg } from '../src/where-interop';
import {
  combineWhereFilters,
  createBoundWhereExpr,
  offsetBoundWhereExpr,
} from '../src/where-utils';
import { getTestContract } from './helpers';

function collectParamIndexes(expr: WhereExpr): number[] {
  return expr.fold<number[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    paramRef: (param) => [param.index],
    listLiteral: (list) =>
      list.values.flatMap((value) => (value.kind === 'param-ref' ? [value.index] : [])),
  });
}

describe('SQL ORM rich AST filters', () => {
  const contract = getTestContract();

  it('builds scalar and relation filters as AST instances', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = and(
      user['name']!.eq('Alice'),
      user['posts']!.some((post) => post['views']!.gt(10)),
    );

    expect(expr.kind).toBe('and');
    const [nameFilter, postsFilter] = expr.exprs;
    expect(nameFilter!.kind).toBe('binary');
    expect(nameFilter!).toMatchObject({
      op: 'eq',
      left: ColumnRef.of('users', 'name'),
      right: LiteralExpr.of('Alice'),
    });

    expect(postsFilter!.kind).toBe('exists');
    const exists = postsFilter! as ExistsExpr;
    expect(exists.subquery.kind).toBe('select');
    expect(exists.subquery.from.kind).toBe('table-source');
    expect(exists.subquery.where!.kind).toBe('and');
  });

  it('normalizes, offsets, combines, and negates bound filters', () => {
    const normalized = normalizeWhereArg({
      toWhereExpr: () => ({
        expr: BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(1, 'id')),
        params: [1],
        paramDescriptors: [{ index: 1, source: 'dsl' as const }],
      }),
    } satisfies ToWhereExpr) as BoundWhereExpr;

    expect(normalized.expr.kind).toBe('binary');
    expect(normalized.params).toEqual([1]);

    const shifted = offsetBoundWhereExpr(normalized, 2);
    expect(collectParamIndexes(shifted.expr as BinaryExpr)).toEqual([3]);

    const combined = combineWhereFilters([
      createBoundWhereExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice'))),
      shifted,
    ]);
    expect(combined?.expr?.kind).toBe('and');

    expect(not(NullCheckExpr.isNull(ColumnRef.of('users', 'email')))).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('users', 'email')),
    );
    expect(or(BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1))).kind).toBe('or');
    expect(all().kind).toBe('and');
  });
});
