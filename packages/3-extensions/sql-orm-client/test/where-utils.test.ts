import { AndExpr, BinaryExpr, ColumnRef, LiteralExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  combinePlainWhereExprs,
  combineWhereFilters,
  createBoundWhereExpr,
} from '../src/where-utils';

describe('where utils', () => {
  it('combines bound filters with AND', () => {
    const a = createBoundWhereExpr(BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)));
    const b = createBoundWhereExpr(
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('x')),
    );
    const combined = combineWhereFilters([a, b]);
    expect(combined?.expr).toBeInstanceOf(AndExpr);
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
