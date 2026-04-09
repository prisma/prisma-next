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
  compileInsertCountSplit,
  compileInsertReturning,
  compileInsertReturningSplit,
  compileUpdateCount,
  compileUpsertReturning,
} from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';

function assertInsertAst(ast: unknown): asserts ast is InsertAst {
  expect((ast as { kind: string }).kind).toBe('insert');
}

function usersColParam(
  contract: ReturnType<typeof getTestContract>,
  column: string,
  value: unknown,
): ParamRef {
  const columns = contract.storage.tables.users?.columns as
    | Record<string, { codecId?: string }>
    | undefined;
  const columnMeta = columns?.[column];
  return ParamRef.of(value, {
    name: column,
    codecId: columnMeta?.codecId ?? 'unknown',
  });
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
      id: usersColParam(contract, 'id', 10),
      name: usersColParam(contract, 'name', 'Alice'),
      email: usersColParam(contract, 'email', 'alice@example.com'),
    });
    expect(plan.ast.rows[0]?.['invited_by_id']?.kind).toBe('default-value');
    expect(plan.ast.rows[1]).toMatchObject({
      id: usersColParam(contract, 'id', 11),
      name: usersColParam(contract, 'name', 'Bob'),
      email: usersColParam(contract, 'email', 'bob@example.com'),
      invited_by_id: usersColParam(contract, 'invited_by_id', 10),
    });
    expect(plan.ast.returning).toEqual([
      ColumnRef.of('users', 'address'),
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
    expect(action.set).toEqual({
      name: usersColParam(contract, 'name', 'Updated Alice'),
    });
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com', 'Updated Alice']);
  });

  describe('compileInsertReturningSplit()', () => {
    it('produces a single plan when all rows have the same columns', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
    });

    it('splits rows with different column sets into separate plans', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
        ],
        undefined,
      );
      expect(plans).toHaveLength(2);
      assertInsertAst(plans[0]!.ast);
      assertInsertAst(plans[1]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(1);
      expect(plans[1]!.ast.rows).toHaveLength(1);
    });

    it('preserves input order: non-adjacent rows with same signature produce separate groups', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
          { id: 3, name: 'Charlie', email: 'c@c.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(3);
    });

    it('groups adjacent rows with identical columns together', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com' },
          { id: 3, name: 'Charlie', email: 'c@c.com', invited_by_id: 1 },
          { id: 4, name: 'Diana', email: 'd@d.com', invited_by_id: 2 },
        ],
        undefined,
      );
      expect(plans).toHaveLength(2);
      assertInsertAst(plans[0]!.ast);
      assertInsertAst(plans[1]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
      expect(plans[1]!.ast.rows).toHaveLength(2);
    });

    it('treats undefined values as absent columns', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com', invited_by_id: undefined },
          { id: 2, name: 'Bob', email: 'b@b.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
    });

    it('handles a single row', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'users',
        [{ id: 1, name: 'Alice', email: 'a@a.com' }],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(1);
    });
  });

  describe('compileInsertCountSplit()', () => {
    it('produces a single plan when all rows have the same columns', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'users', [
        { id: 1, name: 'Alice', email: 'a@a.com' },
        { id: 2, name: 'Bob', email: 'b@b.com' },
      ]);
      expect(plans).toHaveLength(1);
    });

    it('splits rows with different column sets', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'users', [
        { id: 1, name: 'Alice', email: 'a@a.com' },
        { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
      ]);
      expect(plans).toHaveLength(2);
    });

    it('preserves input order over minimizing group count', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'users', [
        { id: 1, name: 'A', email: 'a@a.com' },
        { id: 2, name: 'B', email: 'b@b.com', invited_by_id: 1 },
        { id: 3, name: 'C', email: 'c@c.com' },
      ]);
      expect(plans).toHaveLength(3);
    });
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
