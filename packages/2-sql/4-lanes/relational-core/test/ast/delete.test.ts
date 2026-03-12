import { describe, expect, it } from 'vitest';
import { DeleteAst } from '../../src/ast/delete';
import { BinaryExpr } from '../../src/ast/predicate';
import { col, param, table } from './test-helpers';

describe('ast/delete', () => {
  it('creates delete ASTs with table and where clauses', () => {
    const where = BinaryExpr.eq(col('user', 'id'), param(0, 'userId'));
    const deleteAst = DeleteAst.from(table('user')).withWhere(where);

    expect(deleteAst.table).toEqual(table('user'));
    expect(deleteAst.where).toEqual(where);
    expect(deleteAst.returning).toBeUndefined();
  });

  it('creates delete ASTs with returning clauses', () => {
    const deleteAst = DeleteAst.from(table('user'))
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(0, 'userId')))
      .withReturning([col('user', 'id'), col('user', 'email')]);

    expect(deleteAst.returning).toEqual([col('user', 'id'), col('user', 'email')]);
  });

  it('supports single returning columns and alternate tables', () => {
    expect(
      DeleteAst.from(table('post'))
        .withWhere(BinaryExpr.eq(col('post', 'id'), param(0, 'postId')))
        .withReturning([col('post', 'id')]).returning,
    ).toEqual([col('post', 'id')]);
  });
});
