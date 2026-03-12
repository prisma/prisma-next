import { describe, expect, it } from 'vitest';
import { BinaryExpr } from '../../src/ast/predicate';
import { UpdateAst } from '../../src/ast/update';
import { col, param, table } from './test-helpers';

describe('ast/update', () => {
  it('creates update ASTs with table, set, and where clauses', () => {
    const where = BinaryExpr.eq(col('user', 'id'), param(1, 'userId'));
    const updateAst = UpdateAst.table(table('user'))
      .withSet({
        email: param(0, 'email'),
      })
      .withWhere(where);

    expect(updateAst.table).toEqual(table('user'));
    expect(updateAst.set).toEqual({ email: param(0, 'email') });
    expect(updateAst.where).toEqual(where);
    expect(updateAst.returning).toBeUndefined();
  });

  it('creates update ASTs with returning clauses and multiple set values', () => {
    const updateAst = UpdateAst.table(table('user'))
      .withSet({
        email: param(0, 'email'),
        name: param(1, 'name'),
      })
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(2, 'userId')))
      .withReturning([col('user', 'id'), col('user', 'email')]);

    expect(updateAst.set).toEqual({
      email: param(0, 'email'),
      name: param(1, 'name'),
    });
    expect(updateAst.returning).toEqual([col('user', 'id'), col('user', 'email')]);
  });

  it('supports column refs in set values and empty set objects', () => {
    expect(
      UpdateAst.table(table('user'))
        .withSet({
          id: col('user', 'id'),
          email: param(0, 'email'),
        })
        .withWhere(BinaryExpr.eq(col('user', 'id'), param(1, 'userId'))).set,
    ).toEqual({
      id: col('user', 'id'),
      email: param(0, 'email'),
    });
    expect(UpdateAst.table(table('user')).withSet({}).set).toEqual({});
  });
});
