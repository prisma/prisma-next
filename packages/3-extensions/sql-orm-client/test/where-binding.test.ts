import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  JoinAst,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';
import { getTestContract } from './helpers';

describe('bindWhereExpr', () => {
  const contract = getTestContract();

  it('binds a simple binary eq with a literal to a parameterized expression', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('alice@test.com'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(BinaryExpr);
    const binary = bound as BinaryExpr;
    expect(binary.right).toBeInstanceOf(ParamRef);
    expect((binary.right as ParamRef).value).toBe('alice@test.com');
  });

  it('binds AND expressions recursively', () => {
    const expr = AndExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    ]);
    const bound = bindWhereExpr(contract, expr);

    const and = bound as AndExpr;
    const andRight0 = (and.exprs[0] as BinaryExpr).right;
    const andRight1 = (and.exprs[1] as BinaryExpr).right;
    expect(andRight0).toBeInstanceOf(ParamRef);
    expect(andRight1).toBeInstanceOf(ParamRef);
    expect([(andRight0 as ParamRef).value, (andRight1 as ParamRef).value]).toEqual([
      'a@test.com',
      'Alice',
    ]);
  });

  it('binds OR expressions recursively', () => {
    const expr = OrExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('b@test.com')),
    ]);
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(OrExpr);
    const or = bound as OrExpr;
    const orRight0 = (or.exprs[0] as BinaryExpr).right;
    const orRight1 = (or.exprs[1] as BinaryExpr).right;
    expect(orRight0).toBeInstanceOf(ParamRef);
    expect(orRight1).toBeInstanceOf(ParamRef);
    expect([(orRight0 as ParamRef).value, (orRight1 as ParamRef).value]).toEqual([
      'a@test.com',
      'b@test.com',
    ]);
  });

  it('binds EXISTS subquery expressions', () => {
    const subquery = SelectAst.from(TableSource.named('posts'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')));
    const expr = ExistsExpr.exists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(ExistsExpr);
    expect((bound as ExistsExpr).notExists).toBe(false);
  });

  it('binds NOT EXISTS subquery expressions', () => {
    const subquery = SelectAst.from(TableSource.named('posts')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
    ]);
    const expr = ExistsExpr.notExists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(ExistsExpr);
    expect((bound as ExistsExpr).notExists).toBe(true);
  });

  it('binds IS NULL null-check expressions', () => {
    const expr = NullCheckExpr.isNull(ColumnRef.of('users', 'email'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(NullCheckExpr);
    expect((bound as NullCheckExpr).isNull).toBe(true);
  });

  it('binds IS NOT NULL null-check expressions', () => {
    const expr = NullCheckExpr.isNotNull(ColumnRef.of('users', 'email'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(NullCheckExpr);
    expect((bound as NullCheckExpr).isNull).toBe(false);
  });

  it('binds IN with list literal values to parameterized refs', () => {
    const expr = BinaryExpr.in(
      ColumnRef.of('users', 'id'),
      ListLiteralExpr.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
    );
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right).toBeInstanceOf(ListLiteralExpr);
    const list = binary.right as ListLiteralExpr;
    expect(list.values).toMatchObject([expect.any(ParamRef), expect.any(ParamRef)]);
    expect(list.values).toMatchObject([{ value: 1 }, { value: 2 }]);
  });

  it('preserves ParamRef on the right side without rebinding', () => {
    const existing = ParamRef.of(42, { name: 'id', codecId: 'pg/int4@1' });
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'id'), existing);
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right).toBe(existing);
  });

  it('binds subquery within a select that has joins, orderBy, and derived sources', () => {
    const inner = SelectAst.from(TableSource.named('posts'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('posts', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')));

    const lateral = SelectAst.from(DerivedTableSource.as('p', inner)).withProjection([
      ProjectionItem.of('id', ColumnRef.of('p', 'id')),
    ]);

    const main = SelectAst.from(TableSource.named('users'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
      .withJoins([
        JoinAst.left(
          DerivedTableSource.as('lat', lateral),
          EqColJoinOn.of(ColumnRef.of('users', 'id'), ColumnRef.of('lat', 'id')),
          true,
        ),
      ]);

    const expr = ExistsExpr.exists(main);
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(ExistsExpr);
  });

  it('handles binary expression with non-column left side and literal right', () => {
    const subquery = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('cnt', AggregateExpr.count()),
    ]);
    const expr = BinaryExpr.gt(SubqueryExpr.of(subquery), LiteralExpr.of(0));
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right).toBeInstanceOf(LiteralExpr);
  });

  it('handles binary expression with non-column left side and column right', () => {
    const subquery = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('cnt', AggregateExpr.count()),
    ]);
    const expr = BinaryExpr.gt(SubqueryExpr.of(subquery), ColumnRef.of('users', 'id'));
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right).toBeInstanceOf(ColumnRef);
  });

  it('binds EXISTS with a select that has HAVING, literal projections, and where-expr joins', () => {
    const subquery = SelectAst.from(TableSource.named('users'))
      .withProjection([
        ProjectionItem.of('email', ColumnRef.of('users', 'email')),
        ProjectionItem.of('one', LiteralExpr.of(1)),
      ])
      .withGroupBy([ColumnRef.of('users', 'email')])
      .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)))
      .withJoins([
        JoinAst.inner(
          TableSource.named('posts'),
          BinaryExpr.eq(ColumnRef.of('users', 'id'), ColumnRef.of('posts', 'user_id')),
        ),
      ]);

    const expr = ExistsExpr.exists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound).toBeInstanceOf(ExistsExpr);
  });

  it('passes through ParamRef values inside ListLiteralExpr without rebinding', () => {
    const existing = ParamRef.of(99, { name: 'id', codecId: 'pg/int4@1' });
    const expr = BinaryExpr.in(
      ColumnRef.of('users', 'id'),
      ListLiteralExpr.of([existing, LiteralExpr.of(42)]),
    );
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    const list = binary.right as ListLiteralExpr;
    expect(list.values).toMatchObject([expect.any(ParamRef), expect.any(ParamRef)]);
    expect(list.values[0]).toBe(existing);
    expect(list.values).toMatchObject([{ value: 99 }, { value: 42 }]);
  });
});
