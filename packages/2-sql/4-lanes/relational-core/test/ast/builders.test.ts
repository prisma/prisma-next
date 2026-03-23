import { describe, expect, it } from 'vitest';
import { OrderByItem } from '../../src/ast/order';
import { BinaryExpr } from '../../src/ast/predicate';
import {
  DefaultValueExpr,
  DeleteAst,
  DoNothingConflictAction,
  DoUpdateSetConflictAction,
  InsertAst,
  InsertOnConflict,
  SelectAst,
  UpdateAst,
} from '../../src/exports/ast';
import { col, param, table } from './test-helpers';

describe('ast/builders', () => {
  it('builds select ASTs through fluent rich-node methods', () => {
    const ast = SelectAst.from(table('user'))
      .addProjection('id', col('user', 'id'))
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(1, 'id')))
      .withOrderBy([OrderByItem.asc(col('user', 'id'))])
      .withDistinct()
      .withDistinctOn([col('user', 'email')])
      .withGroupBy([col('user', 'id')])
      .withHaving(BinaryExpr.gt(col('user', 'id'), param(2, 'minId')))
      .withLimit(10)
      .withOffset(5);

    expect(ast).toMatchObject({
      from: table('user'),
      projection: [{ alias: 'id', expr: col('user', 'id') }],
      where: BinaryExpr.eq(col('user', 'id'), param(1, 'id')),
      distinct: true,
      distinctOn: [col('user', 'email')],
      groupBy: [col('user', 'id')],
      having: BinaryExpr.gt(col('user', 'id'), param(2, 'minId')),
      limit: 10,
      offset: 5,
    });
  });

  it('builds insert ASTs with on-conflict update sets', () => {
    const ast = InsertAst.into(table('user'))
      .withValues({
        id: param(1, 'id'),
        email: param(2, 'email'),
      })
      .withOnConflict(
        InsertOnConflict.on([col('user', 'id')]).doUpdateSet({ email: param(3, 'email') }),
      )
      .withReturning([col('user', 'id')]);

    expect(ast.onConflict?.columns).toEqual([col('user', 'id')]);
    expect(ast.onConflict?.action).toBeInstanceOf(DoUpdateSetConflictAction);
    expect(ast.returning).toEqual([col('user', 'id')]);
  });

  it('builds insert ASTs with do-nothing conflicts and explicit row lists', () => {
    const conflictAst = InsertAst.into(table('user'))
      .withValues({
        id: param(1, 'id'),
      })
      .withOnConflict(InsertOnConflict.on([col('user', 'id')]).doNothing());
    const rowAst = InsertAst.into(table('user')).withRows([
      {
        id: param(1, 'id'),
        email: param(2, 'email'),
      },
      {
        id: param(3, 'id2'),
        email: new DefaultValueExpr(),
      },
    ]);

    expect(conflictAst.onConflict?.action).toBeInstanceOf(DoNothingConflictAction);
    expect(rowAst.rows).toEqual([
      {
        id: param(1, 'id'),
        email: param(2, 'email'),
      },
      {
        id: param(3, 'id2'),
        email: new DefaultValueExpr(),
      },
    ]);
    expect(InsertAst.into(table('user')).withRows([]).rows).toEqual([]);
  });

  it('builds update and delete ASTs fluently', () => {
    const where = BinaryExpr.eq(col('user', 'id'), param(1, 'id'));
    const updateAst = UpdateAst.table(table('user'))
      .withSet({ email: param(2, 'email') })
      .withWhere(where)
      .withReturning([col('user', 'id')]);
    const deleteAst = DeleteAst.from(table('user'))
      .withWhere(where)
      .withReturning([col('user', 'id')]);

    expect(updateAst).toMatchObject({ where, returning: [col('user', 'id')] });
    expect(deleteAst).toMatchObject({ where, returning: [col('user', 'id')] });
  });
});
