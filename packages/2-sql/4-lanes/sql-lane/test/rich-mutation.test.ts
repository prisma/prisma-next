import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { DeleteAst, InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import {
  BinaryExpr,
  ColumnRef,
  NullCheckExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(): Contract {
  return validateContract<Contract>(
    JSON.parse(readFileSync(join(fixtureDir, 'contract.json'), 'utf8')),
  );
}

describe('sql lane rich mutation ASTs', () => {
  it('builds insert/update/delete plans with class-based AST nodes and returning metadata', () => {
    const contract = loadContract();
    const context = createTestContext(contract, createStubAdapter());
    const tables = schema<Contract>(context).tables;

    const insertPlan = sql<Contract, CodecTypes>({ context })
      .insert(tables.user, {
        id: param('id'),
        email: param('email'),
        createdAt: param('createdAt'),
      })
      .returning(tables.user.columns.id)
      .build({
        params: {
          id: 1,
          email: 'a@example.com',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      });

    expect(insertPlan.ast.kind).toBe('insert');
    const insertAst = insertPlan.ast as InsertAst;
    expect(insertAst.rows[0]).toMatchObject({
      id: ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
      email: ParamRef.of('a@example.com', {
        name: 'email',
        codecId: 'pg/text@1',
      }),
      createdAt: ParamRef.of('2024-01-01T00:00:00.000Z', {
        name: 'createdAt',
        codecId: 'pg/timestamptz@1',
      }),
    });
    expect(insertAst.returning).toEqual([ColumnRef.of('user', 'id')]);

    const updatePlan = sql<Contract, CodecTypes>({ context })
      .update(tables.user, { email: param('email') })
      .where(tables.user.columns.id.eq(param('id')))
      .returning(tables.user.columns.email)
      .build({
        params: {
          id: 1,
          email: 'updated@example.com',
        },
      });

    expect(updatePlan.ast.kind).toBe('update');
    const updateAst = updatePlan.ast as UpdateAst;
    expect(updateAst.set['email']).toEqual(
      ParamRef.of('updated@example.com', {
        name: 'email',
        codecId: 'pg/text@1',
      }),
    );
    expect(updateAst.where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
      ),
    );
    expect(updateAst.returning).toEqual([ColumnRef.of('user', 'email')]);

    const deletePlan = sql<Contract, CodecTypes>({ context })
      .delete(tables.user)
      .where(tables.user.columns.deletedAt.isNull())
      .returning(tables.user.columns.id)
      .build();

    expect(deletePlan.ast.kind).toBe('delete');
    const deleteAst = deletePlan.ast as DeleteAst;
    expect(deleteAst.where).toEqual(NullCheckExpr.isNull(ColumnRef.of('user', 'deletedAt')));
    expect(deleteAst.returning).toEqual([ColumnRef.of('user', 'id')]);
  });

  it('keeps update and delete guarded by where()', () => {
    const contract = loadContract();
    const context = createTestContext(contract, createStubAdapter());
    const tables = schema<Contract>(context).tables;

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .update(tables.user, { email: param('email') })
        .build({ params: { email: 'missing-where@example.com' } }),
    ).toThrow('where() must be called before building an UPDATE query');

    expect(() => sql<Contract, CodecTypes>({ context }).delete(tables.user).build()).toThrow(
      'where() must be called before building a DELETE query',
    );
  });
});
