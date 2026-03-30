import type { DeleteAst, InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { BinaryExpr, ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('DML builders', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('builds insert plans with values and mutation metadata', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .insert(tables.user, {
        email: param('email'),
        createdAt: param('createdAt'),
      })
      .build({ params: { email: 'test@example.com', createdAt: new Date('2024-01-01') } });

    expect(plan.ast.kind).toBe('insert');
    expect((plan.ast as InsertAst).rows[0]).toEqual({
      email: ParamRef.of('test@example.com', {
        name: 'email',
        codecId: 'pg/text@1',
      }),
      createdAt: ParamRef.of(new Date('2024-01-01'), {
        name: 'createdAt',
        codecId: 'pg/timestamptz@1',
      }),
    });
    expect(plan.meta.annotations).toMatchObject({
      intent: 'write',
      isMutation: true,
    });
  });

  it('builds update and delete plans with where clauses', () => {
    const updatePlan = sql<Contract, CodecTypes>({ context })
      .update(tables.user, { email: param('newEmail') })
      .where(tables.user.columns.id.eq(param('userId')))
      .build({ params: { newEmail: 'updated@example.com', userId: 1 } });
    const deletePlan = sql<Contract, CodecTypes>({ context })
      .delete(tables.user)
      .where(tables.user.columns.id.eq(param('userId')))
      .build({ params: { userId: 1 } });

    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(1, { name: 'userId', codecId: 'pg/int4@1' }),
      ),
    );
    expect(updatePlan.meta.annotations).toMatchObject({ hasWhere: true });

    expect(deletePlan.ast.kind).toBe('delete');
    expect((deletePlan.ast as DeleteAst).where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(1, { name: 'userId', codecId: 'pg/int4@1' }),
      ),
    );
    expect(deletePlan.meta.annotations).toMatchObject({ hasWhere: true });
  });

  it('rejects unknown columns and missing parameters', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .insert(tables.user, { unknownColumn: param('value') } as never)
        .build({ params: { value: 'test' } }),
    ).toThrow('Unknown column unknownColumn in table user');

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .delete(tables.user)
        .where(tables.user.columns.id.eq(param('userId')))
        .build({ params: {} }),
    ).toThrow('Missing value for parameter userId');
  });
});
