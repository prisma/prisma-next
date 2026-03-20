import { describe, expect, it } from 'vitest';
import { BinaryExpr } from '../../src/ast/predicate';
import {
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  JoinAst,
  OrderByItem,
  SelectAst,
} from '../../src/exports/ast';
import { col, lowerExpr, param, simpleSelect, table } from './test-helpers';

describe('ast/select', () => {
  it('creates select ASTs with from and project', () => {
    const selectAst = SelectAst.from(table('user'))
      .addProject('id', col('user', 'id'))
      .addProject('email', col('user', 'email'));

    expect(selectAst).toMatchObject({
      from: table('user'),
      project: [
        { alias: 'id', expr: col('user', 'id') },
        { alias: 'email', expr: col('user', 'email') },
      ],
      joins: undefined,
      where: undefined,
      orderBy: undefined,
      limit: undefined,
      selectAllIntent: undefined,
    });
  });

  it('supports fluent optional clauses immutably', () => {
    const base = SelectAst.from(table('user')).addProject('id', col('user', 'id'));
    const where = BinaryExpr.eq(col('user', 'id'), param(0, 'userId'));
    const selectAst = base
      .withJoins([
        JoinAst.left(table('post'), EqColJoinOn.of(col('user', 'id'), col('post', 'userId'))),
      ])
      .withWhere(where)
      .withOrderBy([OrderByItem.asc(col('user', 'id'))])
      .withLimit(10)
      .withDistinct()
      .withDistinctOn([col('user', 'email')])
      .withGroupBy([col('user', 'id')])
      .withHaving(BinaryExpr.gt(col('user', 'id'), param(1, 'minId')))
      .withOffset(3)
      .withSelectAllIntent({ table: 'user' });

    expect(base).toMatchObject({ joins: undefined, where: undefined });
    expect(selectAst).toMatchObject({
      where,
      orderBy: [OrderByItem.asc(col('user', 'id'))],
      limit: 10,
      distinct: true,
      distinctOn: [col('user', 'email')],
      groupBy: [col('user', 'id')],
      having: BinaryExpr.gt(col('user', 'id'), param(1, 'minId')),
      offset: 3,
      selectAllIntent: { table: 'user' },
    });
    expect(selectAst.joins).toHaveLength(1);
  });

  it('stores operation and exists expressions inside project and where clauses', () => {
    const subquery = simpleSelect('post', ['id']);
    const selectAst = SelectAst.from(table('user'))
      .addProject('result', lowerExpr(col('user', 'email')))
      .withWhere(ExistsExpr.exists(subquery));

    expect(selectAst.project[0]?.expr).toEqual(lowerExpr(col('user', 'email')));
    expect(selectAst.where).toBeInstanceOf(ExistsExpr);
    expect((selectAst.where as ExistsExpr).subquery).toEqual(subquery);
  });

  it('rewrites nested selects, joins, and expressions', () => {
    const derived = DerivedTableSource.as('posts', simpleSelect('post', ['userId']));
    const selectAst = SelectAst.from(table('user'))
      .addProject('email', lowerExpr(col('user', 'email')))
      .withJoins([
        JoinAst.inner(derived, EqColJoinOn.of(col('user', 'id'), col('posts', 'userId')), true),
      ])
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(0, 'userId')));

    const rewritten = selectAst.rewrite({
      tableSource: (source) => (source.name === 'user' ? table('member') : source),
      columnRef: (expr) => (expr.table === 'user' ? col('member', expr.column) : expr),
      paramRef: (expr) => expr.withIndex(expr.index + 1),
    });

    expect(rewritten.from).toEqual(table('member'));
    expect(rewritten.project[0]?.expr).toEqual(lowerExpr(col('member', 'email')));
    expect(rewritten.where).toEqual(BinaryExpr.eq(col('member', 'id'), param(1, 'userId')));
    expect((rewritten.joins?.[0]?.source as DerivedTableSource).query.project).toEqual([
      { alias: 'userId', expr: col('post', 'userId') },
    ]);
  });

  it('drops empty optional collections back to undefined', () => {
    const selectAst = SelectAst.from(table('user'))
      .addProject('id', col('user', 'id'))
      .withJoins([])
      .withOrderBy([])
      .withDistinctOn([])
      .withGroupBy([]);

    expect(selectAst).toMatchObject({
      joins: undefined,
      orderBy: undefined,
      distinctOn: undefined,
      groupBy: undefined,
    });
  });
});
