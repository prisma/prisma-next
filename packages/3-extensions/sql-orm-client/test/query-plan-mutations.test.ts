import {
  ColumnRef,
  type DeleteAst,
  type DoUpdateSetConflictAction,
  type InsertAst,
  ParamRef,
  type UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteCount,
  compileInsertCount,
  compileInsertReturning,
  compileUpdateCount,
  compileUpsertReturning,
} from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';

function assertInsertAst(ast: unknown): asserts ast is InsertAst {
  expect((ast as { kind: string }).kind).toBe('insert');
}

describe('query plan mutations', () => {
  it('compileInsertReturning() batches rows with stable column order and DEFAULT cells', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileInsertReturning(
      contract,
      'users',
      [
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com', invited_by_id: 10 },
      ],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([
      10,
      'Alice',
      'alice@example.com',
      11,
      'Bob',
      'bob@example.com',
      10,
    ]);
    expect(plan.ast.rows).toHaveLength(2);
    expect(plan.ast.rows[0]).toMatchObject({
      id: ParamRef.of(1, 'id'),
      name: ParamRef.of(2, 'name'),
      email: ParamRef.of(3, 'email'),
    });
    expect(plan.ast.rows[0]?.['invited_by_id']?.kind).toBe('default-value');
    expect(plan.ast.rows[1]).toEqual({
      id: ParamRef.of(4, 'id'),
      name: ParamRef.of(5, 'name'),
      email: ParamRef.of(6, 'email'),
      invited_by_id: ParamRef.of(7, 'invited_by_id'),
    });
    expect(plan.ast.returning).toEqual([
      ColumnRef.of('users', 'email'),
      ColumnRef.of('users', 'id'),
      ColumnRef.of('users', 'invited_by_id'),
      ColumnRef.of('users', 'name'),
    ]);
  });

  it('compileInsertCount() keeps explicit empty rows for all-default batch inserts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(contract, 'users', [{}, {}]);

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([]);
    expect(plan.ast.rows).toEqual([{}, {}]);
  });

  it('compileUpsertReturning() uses DO NOTHING and default returning columns when update is empty', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileUpsertReturning(
      contract,
      'users',
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      {},
      ['email'],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.action?.kind).toBe('do-nothing');
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com']);
    expect(plan.ast.returning).toEqual(
      Object.keys(contract.storage.tables.users.columns).map((column) =>
        ColumnRef.of('users', column),
      ),
    );
  });

  it('compileInsertReturning() rejects empty rows array', () => {
    const contract = withReturningCapability(getTestContract());

    expect(() => compileInsertReturning(contract, 'users', [], undefined)).toThrow(
      'at least one row',
    );
  });

  it('compileInsertCount() rejects empty rows array', () => {
    const contract = getTestContract();

    expect(() => compileInsertCount(contract, 'users', [])).toThrow('at least one row');
  });

  it('compileUpsertReturning() produces DoUpdateSetConflictAction with correct params when update is non-empty', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileUpsertReturning(
      contract,
      'users',
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      { name: 'Updated Alice' },
      ['email'],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.action?.kind).toBe('do-update-set');
    const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
    expect(action.set).toEqual({ name: ParamRef.of(4, 'name') });
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com', 'Updated Alice']);
  });

  it('compileUpdateCount() and compileDeleteCount() omit WHERE when filters are empty', () => {
    const contract = getTestContract();

    const updatePlan = compileUpdateCount(contract, 'users', { name: 'Alice' }, []);
    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where).toBeUndefined();
    expect(updatePlan.params).toEqual(['Alice']);

    const deletePlan = compileDeleteCount(contract, 'users', []);
    expect(deletePlan.ast.kind).toBe('delete');
    expect((deletePlan.ast as DeleteAst).where).toBeUndefined();
    expect(deletePlan.params).toEqual([]);
  });
});
