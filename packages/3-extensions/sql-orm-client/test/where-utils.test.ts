import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { combinePlainWhereExprs, offsetBoundWhereExpr } from '../src/where-utils';

describe('where utils', () => {
  it('keeps zero-offset bound filters stable', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1));
    const bound = {
      expr,
      params: [1],
      paramDescriptors: [{ index: 1, source: 'dsl' as const }],
    };

    expect(offsetBoundWhereExpr(bound, 0)).toEqual(bound);
  });

  it('offsets param refs and descriptors when filters are shifted', () => {
    const bound = {
      expr: BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(1, 'id')),
      params: [7],
      paramDescriptors: [{ index: 1, source: 'dsl' as const }],
    };

    expect(offsetBoundWhereExpr(bound, 2)).toEqual({
      expr: BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(3, 'id')),
      params: [7],
      paramDescriptors: [{ index: 3, source: 'dsl' as const }],
    });
  });

  it('returns the original expression when only one plain filter is provided', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice'));
    expect(combinePlainWhereExprs([expr])).toBe(expr);
  });

  it('combines multiple plain filters with AND', () => {
    const first = BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1));
    const second = BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice'));

    expect(combinePlainWhereExprs([first, second])).toEqual(AndExpr.of([first, second]));
  });
});
