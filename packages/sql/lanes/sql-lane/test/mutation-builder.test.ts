import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createTableRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
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
          } as Record<string, typeof param>)
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
          { kind: 'col', table: 'user', column: 'id' },
          { kind: 'col', table: 'user', column: 'email' },
        ]),
      });
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
          } as Record<string, typeof param>)
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
          { kind: 'col', table: 'user', column: 'id' },
          { kind: 'col', table: 'user', column: 'email' },
        ]),
      });
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
          { kind: 'col', table: 'user', column: 'id' },
          { kind: 'col', table: 'user', column: 'email' },
        ]),
      });
    });
  });
});
