import { describe, expect, it } from 'vitest';
import {
  DefaultValueExpr,
  type DoUpdateSetConflictAction,
  InsertAst,
  InsertOnConflict,
} from '../../src/exports/ast';
import { col, param, table } from './test-helpers';

describe('ast/insert', () => {
  it('creates insert ASTs with a single values row', () => {
    const insertAst = InsertAst.into(table('user')).withValues({
      id: param(0, 'id'),
      email: param(1, 'email'),
    });

    expect(insertAst.table).toEqual(table('user'));
    expect(insertAst.rows).toEqual([
      {
        id: param(0, 'id'),
        email: param(1, 'email'),
      },
    ]);
    expect(insertAst.returning).toBeUndefined();
  });

  it('creates insert ASTs with returning columns', () => {
    const insertAst = InsertAst.into(table('user'))
      .withValues({
        id: param(0, 'id'),
        email: param(1, 'email'),
      })
      .withReturning([col('user', 'id'), col('user', 'email')]);

    expect(insertAst.returning).toEqual([col('user', 'id'), col('user', 'email')]);
  });

  it('creates insert ASTs with multiple rows and explicit defaults', () => {
    const insertAst = InsertAst.into(table('user')).withRows([
      {
        id: param(0, 'id'),
        email: param(1, 'email'),
      },
      {
        id: param(2, 'id2'),
        email: new DefaultValueExpr(),
      },
    ]);

    expect(insertAst.rows[1]?.['email']).toEqual(new DefaultValueExpr());
  });

  it('preserves empty value objects and explicit empty row lists', () => {
    expect(InsertAst.into(table('user')).withValues({}).rows).toEqual([{}]);
    expect(InsertAst.into(table('user')).withRows([]).rows).toEqual([]);
  });

  it('stores on-conflict update actions', () => {
    const onConflict = InsertOnConflict.on([col('user', 'id')]).doUpdateSet({
      email: param(2, 'updatedEmail'),
    });
    const insertAst = InsertAst.into(table('user'))
      .withValues({
        id: param(0, 'id'),
        email: param(1, 'email'),
      })
      .withOnConflict(onConflict);

    expect(insertAst.onConflict?.columns).toEqual([col('user', 'id')]);
    expect((insertAst.onConflict?.action as DoUpdateSetConflictAction).set).toEqual({
      email: param(2, 'updatedEmail'),
    });
  });

  it('stores on-conflict do-nothing actions', () => {
    const insertAst = InsertAst.into(table('user'))
      .withValues({ id: param(0, 'id') })
      .withOnConflict(InsertOnConflict.on([col('user', 'id')]).doNothing());

    expect(insertAst.onConflict?.action?.kind).toBe('do-nothing');
  });
});
