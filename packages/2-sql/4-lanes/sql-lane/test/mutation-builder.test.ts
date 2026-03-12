import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('mutation builders', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('builds insert plans with returning columns', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .insert(tables.user, {
        email: param('email'),
        createdAt: param('createdAt'),
      })
      .returning(tables.user.columns.id, tables.user.columns.email)
      .build({ params: { email: 'test@example.com', createdAt: new Date('2024-01-01') } });

    expect(plan.ast).toBeInstanceOf(InsertAst);
    const ast = plan.ast as InsertAst;
    expect(ast.rows[0]).toMatchObject({
      email: ParamRef.of(1, 'email'),
      createdAt: ParamRef.of(2, 'createdAt'),
    });
    expect(ast.returning).toEqual([ColumnRef.of('user', 'id'), ColumnRef.of('user', 'email')]);
  });

  it('builds update and delete plans with where clauses and returning columns', () => {
    const updatePlan = sql<Contract, CodecTypes>({ context })
      .update(tables.user, { email: param('newEmail') })
      .where(tables.user.columns.id.eq(param('userId')))
      .returning(tables.user.columns.id, tables.user.columns.email)
      .build({ params: { newEmail: 'updated@example.com', userId: 1 } });
    const deletePlan = sql<Contract, CodecTypes>({ context })
      .delete(tables.user)
      .where(tables.user.columns.id.eq(param('userId')))
      .returning(tables.user.columns.id, tables.user.columns.email)
      .build({ params: { userId: 1 } });

    expect(updatePlan.ast).toBeInstanceOf(UpdateAst);
    expect((updatePlan.ast as UpdateAst).where).toEqual(
      BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(2, 'userId')),
    );
    expect((updatePlan.ast as UpdateAst).returning).toEqual([
      ColumnRef.of('user', 'id'),
      ColumnRef.of('user', 'email'),
    ]);
    expect(deletePlan.ast).toBeInstanceOf(DeleteAst);
    expect((deletePlan.ast as DeleteAst).returning).toEqual([
      ColumnRef.of('user', 'id'),
      ColumnRef.of('user', 'email'),
    ]);
  });

  it('rejects unknown tables, unknown columns, and missing where clauses', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .insert({ name: 'nonexistent' }, { email: param('email') })
        .build({ params: { email: 'x' } }),
    ).toThrow('Unknown table nonexistent');

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .insert(tables.user, { unknownColumn: param('value') } as never)
        .build({ params: { value: 'x' } }),
    ).toThrow('Unknown column unknownColumn in table user');

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .update(tables.user, { email: param('email') })
        .build({ params: { email: 'x' } }),
    ).toThrow('where() must be called before building an UPDATE query');

    expect(() => sql<Contract, CodecTypes>({ context }).delete(tables.user).build()).toThrow(
      'where() must be called before building a DELETE query',
    );
  });
});
