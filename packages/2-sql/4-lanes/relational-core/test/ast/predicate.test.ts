import { describe, expect, it } from 'vitest';
import {
  AndExpr,
  BinaryExpr,
  ExistsExpr,
  ListLiteralExpr,
  NullCheckExpr,
  OrExpr,
} from '../../src/ast/types';
import { col, lit, lowerExpr, param, simpleSelect } from './test-helpers';

describe('ast/predicate', () => {
  it('creates binary expressions across comparable operands', () => {
    const left = lowerExpr(col('user', 'email'));
    const list = ListLiteralExpr.of([param(0, 'firstId'), param(1, 'secondId')]);

    expect(BinaryExpr.eq(col('user', 'id'), param(2, 'userId'))).toEqual(
      new BinaryExpr('eq', col('user', 'id'), param(2, 'userId')),
    );
    expect(BinaryExpr.eq(left, col('post', 'email')).left).toEqual(left);
    expect(BinaryExpr.in(col('user', 'id'), list).right).toEqual(list);
  });

  it.each([
    'eq',
    'neq',
    'gt',
    'lt',
    'gte',
    'lte',
    'like',
    'ilike',
    'in',
    'notIn',
  ] as const)('stores the %s operator', (op) => {
    const expr = new BinaryExpr(op, col('user', 'id'), col('post', 'userId'));
    expect(expr.op).toBe(op);
    expect(expr.right).toEqual(col('post', 'userId'));
  });

  it('negates binary, null-check, and composite predicates through not()', () => {
    expect(BinaryExpr.eq(col('user', 'id'), param(0)).not()).toEqual(
      BinaryExpr.neq(col('user', 'id'), param(0)),
    );
    expect(NullCheckExpr.isNull(col('user', 'deletedAt')).not()).toEqual(
      NullCheckExpr.isNotNull(col('user', 'deletedAt')),
    );
    expect(
      AndExpr.of([
        BinaryExpr.eq(col('user', 'id'), param(0)),
        NullCheckExpr.isNull(col('user', 'deletedAt')),
      ]).not(),
    ).toEqual(
      OrExpr.of([
        BinaryExpr.neq(col('user', 'id'), param(0)),
        NullCheckExpr.isNotNull(col('user', 'deletedAt')),
      ]),
    );
  });

  it('creates exists and not-exists predicates around select subqueries', () => {
    const subquery = simpleSelect('post', ['id']);

    const existsExpr = ExistsExpr.exists(subquery);
    const notExistsExpr = ExistsExpr.notExists(subquery);

    expect(existsExpr.subquery).toEqual(subquery);
    expect(existsExpr.notExists).toBe(false);
    expect(notExistsExpr.notExists).toBe(true);
    expect(notExistsExpr.not()).toEqual(existsExpr);
  });

  it('collects refs across nested predicate trees', () => {
    const where = OrExpr.of([
      BinaryExpr.eq(lowerExpr(col('user', 'email')), lit('a@example.com')),
      ExistsExpr.exists(
        simpleSelect('post', ['id']).withWhere(
          BinaryExpr.eq(col('post', 'userId'), col('user', 'id')),
        ),
      ),
    ]);

    expect(where.collectColumnRefs()).toEqual([
      col('user', 'email'),
      col('post', 'id'),
      col('post', 'userId'),
      col('user', 'id'),
    ]);
  });
});
