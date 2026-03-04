import {
  createColumnRef,
  createParamRef,
  type InsertAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileInsertCount, compileInsertReturning } from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';

function assertInsertAst(ast: unknown): asserts ast is InsertAst {
  expect(ast).toMatchObject({ kind: 'insert' });
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
    expect(plan.ast.rows[0]).toEqual({
      id: createParamRef(1, 'id'),
      name: createParamRef(2, 'name'),
      email: createParamRef(3, 'email'),
      invited_by_id: { kind: 'default' },
    });
    expect(plan.ast.rows[1]).toEqual({
      id: createParamRef(4, 'id'),
      name: createParamRef(5, 'name'),
      email: createParamRef(6, 'email'),
      invited_by_id: createParamRef(7, 'invited_by_id'),
    });
    expect(plan.ast.returning).toEqual([
      createColumnRef('users', 'email'),
      createColumnRef('users', 'id'),
      createColumnRef('users', 'invited_by_id'),
      createColumnRef('users', 'name'),
    ]);
  });

  it('compileInsertCount() keeps explicit empty rows for all-default batch inserts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(contract, 'users', [{}, {}]);

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([]);
    expect(plan.ast.rows).toEqual([{}, {}]);
  });
});
