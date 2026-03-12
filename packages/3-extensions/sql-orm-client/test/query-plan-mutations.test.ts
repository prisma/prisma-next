import {
  ColumnRef,
  DefaultValueExpr,
  type InsertAst,
  InsertAst as InsertAstClass,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileInsertCount, compileInsertReturning } from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';

function assertInsertAst(ast: unknown): asserts ast is InsertAst {
  expect(ast).toBeInstanceOf(InsertAstClass);
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
    expect(plan.ast.rows[0]?.['invited_by_id']).toBeInstanceOf(DefaultValueExpr);
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
});
