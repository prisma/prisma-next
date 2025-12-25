import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { InsertAst } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef, createTableRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('mutation builder edge cases', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userTable = tables.user;
  const userColumns = userTable.columns;

  describe('insert', () => {
    it('throws when table does not exist', () => {
      const nonexistentTable = createTableRef('nonexistent');
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .insert(nonexistentTable, {
            email: param('email'),
          })
          .build({ params: { email: 'test@example.com' } }),
      ).toThrow('Unknown table nonexistent');
    });

    it('throws when column does not exist', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .insert(userTable, {
            nonexistent: param('value'),
          } as unknown as Record<string, ParamPlaceholder>)
          .build({ params: { value: 'test' } }),
      ).toThrow('Unknown column nonexistent in table user');
    });

    it('throws when parameter is missing', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .insert(userTable, {
            email: param('email'),
          })
          .build({ params: {} }),
      ).toThrow('Missing value for parameter email');
    });

    it('builds insert with returning', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .insert(userTable, {
          email: param('email'),
        })
        .returning(userColumns.id, userColumns.email)
        .build({ params: { email: 'test@example.com' } });

      expect(plan.ast).toMatchObject({
        kind: 'insert',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'email'),
        ]),
      });
    });

    it('builds insert without returning columns', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .insert(userTable, {
          email: param('email'),
        })
        .build({ params: { email: 'test@example.com' } });

      const insertAst = plan.ast as InsertAst;
      expect(insertAst).toMatchObject({
        kind: 'insert',
      });
      expect(insertAst.returning).toBeUndefined();
      // When there are no returning columns, projection map is empty
      expect(plan.meta.projection).toEqual({});
    });

    it('handles nullable columns in insert', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .insert(userTable, {
          email: param('email'),
          deletedAt: param('deletedAt'),
        })
        .returning(userColumns.id, userColumns.deletedAt)
        .build({ params: { email: 'test@example.com', deletedAt: null } });

      expect(plan.ast).toMatchObject({
        kind: 'insert',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'deletedAt'),
        ]),
      });
      expect(plan.meta.paramDescriptors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'deletedAt',
            nullable: true,
          }),
        ]),
      );
    });
  });

  describe('update', () => {
    it('throws when table does not exist', () => {
      const nonexistentTable = createTableRef('nonexistent');
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .update(nonexistentTable, {
            email: param('email'),
          })
          .where(userColumns.id.eq(param('userId')))
          .build({ params: { email: 'test@example.com', userId: 1 } }),
      ).toThrow('Unknown table nonexistent');
    });

    it('throws when column does not exist', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .update(userTable, {
            nonexistent: param('value'),
          } as unknown as Record<string, ParamPlaceholder>)
          .where(userColumns.id.eq(param('userId')))
          .build({ params: { value: 'test', userId: 1 } }),
      ).toThrow('Unknown column nonexistent in table user');
    });

    it('throws when parameter is missing in set', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .update(userTable, {
            email: param('email'),
          })
          .where(userColumns.id.eq(param('userId')))
          .build({ params: { userId: 1 } }),
      ).toThrow('Missing value for parameter email');
    });

    it('throws when parameter is missing in where', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .update(userTable, {
            email: param('email'),
          })
          .where(userColumns.id.eq(param('userId')))
          .build({ params: { email: 'test@example.com' } }),
      ).toThrow('Missing value for parameter userId');
    });

    it('throws when where is not called', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .update(userTable, {
            email: param('email'),
          })
          .build({ params: { email: 'test@example.com' } }),
      ).toThrow('where() must be called before building an UPDATE query');
    });

    it('builds update with returning', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .update(userTable, {
          email: param('email'),
        })
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email)
        .build({ params: { email: 'test@example.com', userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'email'),
        ]),
      });
    });

    it('chains returning in update', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .update(userTable, {
          email: param('email'),
        })
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id)
        .returning(userColumns.email)
        .build({ params: { email: 'test@example.com', userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'email'),
        ]),
      });
    });

    it('handles nullable columns in update', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .update(userTable, {
          deletedAt: param('deletedAt'),
        })
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.deletedAt)
        .build({ params: { deletedAt: null, userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'deletedAt'),
        ]),
      });
      expect(plan.meta.paramDescriptors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'deletedAt',
            nullable: true,
          }),
        ]),
      );
    });
  });

  describe('delete', () => {
    it('throws when table does not exist', () => {
      const nonexistentTable = createTableRef('nonexistent');
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .delete(nonexistentTable)
          .where(userColumns.id.eq(param('userId')))
          .build({ params: { userId: 1 } }),
      ).toThrow('Unknown table nonexistent');
    });

    it('throws when parameter is missing in where', () => {
      expect(() =>
        sql<Contract, CodecTypes>({ context })
          .delete(userTable)
          .where(userColumns.id.eq(param('userId')))
          .build({ params: {} }),
      ).toThrow('Missing value for parameter userId');
    });

    it('throws when where is not called', () => {
      expect(() => sql<Contract, CodecTypes>({ context }).delete(userTable).build()).toThrow(
        'where() must be called before building a DELETE query',
      );
    });

    it('builds delete with returning', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .delete(userTable)
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email)
        .build({ params: { userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'email'),
        ]),
      });
    });

    it('chains returning in delete', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .delete(userTable)
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id)
        .returning(userColumns.email)
        .build({ params: { userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        returning: expect.arrayContaining([
          createColumnRef('user', 'id'),
          createColumnRef('user', 'email'),
        ]),
      });
    });
  });
});
