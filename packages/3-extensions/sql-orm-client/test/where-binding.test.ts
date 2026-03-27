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

    expect(bound.params).toEqual(['alice@test.com']);
    expect(bound.paramDescriptors).toHaveLength(1);
    expect(bound.expr.kind).toBe('binary');
    const binary = bound.expr as BinaryExpr;
    expect(binary.right.kind).toBe('param-ref');
  });

  it('binds AND expressions recursively', () => {
    const expr = AndExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    ]);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual(['a@test.com', 'Alice']);
    expect(bound.paramDescriptors).toHaveLength(2);
  });

  it('binds OR expressions recursively', () => {
    const expr = OrExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('b@test.com')),
    ]);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual(['a@test.com', 'b@test.com']);
    expect(bound.expr.kind).toBe('or');
  });

  it('binds EXISTS subquery expressions', () => {
    const subquery = SelectAst.from(TableSource.named('posts'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')));
    const expr = ExistsExpr.exists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.expr.kind).toBe('exists');
    expect((bound.expr as ExistsExpr).notExists).toBe(false);
  });

  it('binds NOT EXISTS subquery expressions', () => {
    const subquery = SelectAst.from(TableSource.named('posts')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
    ]);
    const expr = ExistsExpr.notExists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.expr.kind).toBe('exists');
    expect((bound.expr as ExistsExpr).notExists).toBe(true);
  });

  it('binds IS NULL null-check expressions', () => {
    const expr = NullCheckExpr.isNull(ColumnRef.of('users', 'email'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.expr.kind).toBe('null-check');
    expect((bound.expr as NullCheckExpr).isNull).toBe(true);
  });

  it('binds IS NOT NULL null-check expressions', () => {
    const expr = NullCheckExpr.isNotNull(ColumnRef.of('users', 'email'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.expr.kind).toBe('null-check');
    expect((bound.expr as NullCheckExpr).isNull).toBe(false);
  });

  it('binds IN with list literal values to parameterized refs', () => {
    const expr = BinaryExpr.in(
      ColumnRef.of('users', 'id'),
      ListLiteralExpr.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
    );
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual([1, 2]);
    const binary = bound.expr as BinaryExpr;
    expect(binary.right.kind).toBe('list-literal');
    const list = binary.right as ListLiteralExpr;
    expect(list.values[0]!.kind).toBe('param-ref');
    expect(list.values[1]!.kind).toBe('param-ref');
  });

  it('preserves ParamRef on the right side without rebinding', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(1, 'id'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual([]);
    const binary = bound.expr as BinaryExpr;
    expect(binary.right.kind).toBe('param-ref');
    expect((binary.right as ParamRef).index).toBe(1);
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

    expect(bound.expr.kind).toBe('exists');
  });

  it('handles binary expression with non-column left side and literal right', () => {
    const subquery = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('cnt', AggregateExpr.count()),
    ]);
    const expr = BinaryExpr.gt(SubqueryExpr.of(subquery), LiteralExpr.of(0));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual([]);
    const binary = bound.expr as BinaryExpr;
    expect(binary.right.kind).toBe('literal');
  });

  it('handles binary expression with non-column left side and column right', () => {
    const subquery = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('cnt', AggregateExpr.count()),
    ]);
    const expr = BinaryExpr.gt(SubqueryExpr.of(subquery), ColumnRef.of('users', 'id'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual([]);
    const binary = bound.expr as BinaryExpr;
    expect(binary.right.kind).toBe('column-ref');
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

    expect(bound.expr.kind).toBe('exists');
  });

  it('passes through ParamRef values inside ListLiteralExpr without rebinding', () => {
    const expr = BinaryExpr.in(
      ColumnRef.of('users', 'id'),
      ListLiteralExpr.of([ParamRef.of(1, 'id'), LiteralExpr.of(42)]),
    );
    const bound = bindWhereExpr(contract, expr);

    expect(bound.params).toEqual([42]);
    const binary = bound.expr as BinaryExpr;
    const list = binary.right as ListLiteralExpr;
    expect(list.values[0]!.kind).toBe('param-ref');
    expect((list.values[0]! as ParamRef).index).toBe(1);
    expect(list.values[1]!.kind).toBe('param-ref');
    expect((list.values[1]! as ParamRef).index).toBe(1);
  });
});
