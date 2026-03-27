import type { DeleteAst, InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { BinaryExpr, ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
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

    expect(plan.ast.kind).toBe('insert');
    const ast = plan.ast as InsertAst;
    expect(ast.rows[0]).toMatchObject({
      email: ParamRef.of('test@example.com', {
        name: 'email',
        codecId: 'pg/text@1',
      }),
      createdAt: ParamRef.of(new Date('2024-01-01'), {
        name: 'createdAt',
        codecId: 'pg/timestamptz@1',
      }),
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

    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(1, { name: 'userId', codecId: 'pg/int4@1' }),
      ),
    );
    expect((updatePlan.ast as UpdateAst).returning).toEqual([
      ColumnRef.of('user', 'id'),
      ColumnRef.of('user', 'email'),
    ]);
    expect(deletePlan.ast.kind).toBe('delete');
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

  it('applies execution defaults for create and update mutations', () => {
    const contractWithDefaults = {
      ...contract,
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'email' },
              onCreate: { kind: 'generator', id: 'nanoid', params: { size: 8 } },
            },
            {
              ref: { table: 'user', column: 'deletedAt' },
              onUpdate: { kind: 'generator', id: 'nanoid', params: { size: 6 } },
            },
          ],
        },
      },
    } satisfies Contract;
    const contextWithDefaults = createFixtureContext(contractWithDefaults);
    const defaultTables = schema<typeof contractWithDefaults>(contextWithDefaults).tables;

    const insertPlan = sql<typeof contractWithDefaults, CodecTypes>({
      context: contextWithDefaults,
    })
      .insert(defaultTables.user, {
        createdAt: param('createdAt'),
      })
      .build({ params: { createdAt: new Date('2024-01-01T00:00:00.000Z') } });

    expect(insertPlan.ast.kind).toBe('insert');
    expect(insertPlan.params).toHaveLength(2);
    expect((insertPlan.ast as InsertAst).rows[0]).toMatchObject({
      createdAt: ParamRef.of(new Date('2024-01-01T00:00:00.000Z'), {
        name: 'createdAt',
        codecId: 'pg/timestamptz@1',
      }),
      email: ParamRef.of(insertPlan.params[1], {
        name: 'email',
        codecId: 'pg/text@1',
      }),
    });
    expect(typeof insertPlan.params[1]).toBe('string');
    expect((insertPlan.params[1] as string).length).toBe(8);

    const updatePlan = sql<typeof contractWithDefaults, CodecTypes>({
      context: contextWithDefaults,
    })
      .update(defaultTables.user, {
        email: param('newEmail'),
      })
      .where(defaultTables.user.columns.id.eq(param('userId')))
      .build({ params: { newEmail: 'updated@example.com', userId: 1 } });

    expect(updatePlan.ast.kind).toBe('update');
    expect(updatePlan.params).toHaveLength(3);
    expect((updatePlan.ast as UpdateAst).set).toMatchObject({
      email: ParamRef.of('updated@example.com', {
        name: 'newEmail',
        codecId: 'pg/text@1',
      }),
      deletedAt: ParamRef.of(updatePlan.params[1], {
        name: 'deletedAt',
        codecId: 'pg/timestamptz@1',
      }),
    });
    expect((updatePlan.ast as UpdateAst).where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(1, { name: 'userId', codecId: 'pg/int4@1' }),
      ),
    );
    expect(typeof updatePlan.params[1]).toBe('string');
    expect((updatePlan.params[1] as string).length).toBe(6);
  });
});
