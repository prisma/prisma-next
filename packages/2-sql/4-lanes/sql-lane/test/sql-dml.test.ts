import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type {
  Adapter,
  DeleteAst,
  InsertAst,
  LoweredStatement,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry, createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
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

function createStubAdapter(): Adapter<
  SelectAst | InsertAst | UpdateAst | DeleteAst,
  SqlContract<SqlStorage>,
  LoweredStatement
> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(
      ast: SelectAst | InsertAst | UpdateAst | DeleteAst,
      ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] },
    ) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('DML builders', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;

  describe('insert', () => {
    it('builds an insert plan with values', () => {
      const plan = sql<Contract, CodecTypes>({ context })
        .insert(tables.user, {
          email: param('email'),
          createdAt: param('createdAt'),
        })
        .build({ params: { email: 'test@example.com', createdAt: new Date('2024-01-01') } });

      expect(plan.ast).toMatchObject({
        kind: 'insert',
        table: { name: 'user' },
        values: {
          email: { kind: 'param', name: 'email', index: 1 },
          createdAt: { kind: 'param', name: 'createdAt', index: 2 },
        },
      });

      expect(plan.params).toEqual(['test@example.com', new Date('2024-01-01')]);
      expect(plan.meta).toMatchObject({
        target: 'postgres',
        storageHash: contract.storageHash,
        lane: 'dsl',
        annotations: {
          intent: 'write',
          isMutation: true,
        },
      });
    });

    it('builds an insert plan with returning clause', () => {
      const userColumns = tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context })
        .insert(tables.user, {
          email: param('email'),
          createdAt: param('createdAt'),
        })
        .returning(userColumns.id, userColumns.email)
        .build({ params: { email: 'test@example.com', createdAt: new Date('2024-01-01') } });

      expect(plan.ast).toMatchObject({
        kind: 'insert',
        table: { name: 'user' },
        values: {
          email: { kind: 'param', name: 'email', index: 1 },
          createdAt: { kind: 'param', name: 'createdAt', index: 2 },
        },
        returning: [createColumnRef('user', 'id'), createColumnRef('user', 'email')],
      });
    });

    it('throws error for unknown column', () => {
      expect(() => {
        sql<Contract, CodecTypes>({ context })
          .insert(tables.user, {
            unknownColumn: param('value'),
            // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
          } as any)
          .build({ params: { value: 'test' } });
      }).toThrow('Unknown column unknownColumn in table user');
    });

    it('throws error for missing parameter', () => {
      expect(() => {
        sql<Contract, CodecTypes>({ context })
          .insert(tables.user, {
            email: param('email'),
          })
          .build({ params: {} });
      }).toThrow('Missing value for parameter email');
    });
  });

  describe('update', () => {
    it('builds an update plan with set and where', () => {
      const userColumns = tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context })
        .update(tables.user, {
          email: param('newEmail'),
        })
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { newEmail: 'updated@example.com', userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        table: { name: 'user' },
        set: {
          email: { kind: 'param', name: 'newEmail', index: 1 },
        },
        where: {
          left: { table: 'user', column: 'id' },
          right: { kind: 'param', name: 'userId', index: 2 },
        },
      });

      expect(plan.params).toEqual(['updated@example.com', 1]);
      expect(plan.meta).toMatchObject({
        target: 'postgres',
        storageHash: contract.storageHash,
        lane: 'dsl',
        annotations: {
          intent: 'write',
          isMutation: true,
          hasWhere: true,
        },
      });
    });

    it('builds an update plan with returning clause', () => {
      const userColumns = tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context })
        .update(tables.user, {
          email: param('newEmail'),
        })
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email)
        .build({ params: { newEmail: 'updated@example.com', userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        table: { name: 'user' },
        set: {
          email: { kind: 'param', name: 'newEmail', index: 1 },
        },
        where: {
          left: { table: 'user', column: 'id' },
          right: { kind: 'param', name: 'userId', index: 2 },
        },
        returning: [createColumnRef('user', 'id'), createColumnRef('user', 'email')],
      });
    });

    it('throws error if where is not called', () => {
      expect(() => {
        sql<Contract, CodecTypes>({ context })
          .update(tables.user, {
            email: param('newEmail'),
          })
          .build({ params: { newEmail: 'updated@example.com' } });
      }).toThrow('where() must be called before building an UPDATE query');
    });

    it('throws error for unknown column', () => {
      const userColumns = tables.user.columns;
      expect(() => {
        sql<Contract, CodecTypes>({ context })
          .update(tables.user, {
            unknownColumn: param('value'),
            // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
          } as any)
          .where(userColumns.id.eq(param('userId')))
          .build({ params: { value: 'test', userId: 1 } });
      }).toThrow('Unknown column unknownColumn in table user');
    });
  });

  describe('delete', () => {
    it('builds a delete plan with where', () => {
      const userColumns = tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context })
        .delete(tables.user)
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        table: { name: 'user' },
        where: {
          left: { table: 'user', column: 'id' },
          right: { kind: 'param', name: 'userId', index: 1 },
        },
      });

      expect(plan.params).toEqual([1]);
      expect(plan.meta).toMatchObject({
        target: 'postgres',
        storageHash: contract.storageHash,
        lane: 'dsl',
        annotations: {
          intent: 'write',
          isMutation: true,
          hasWhere: true,
        },
      });
    });

    it('builds a delete plan with returning clause', () => {
      const userColumns = tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context })
        .delete(tables.user)
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email)
        .build({ params: { userId: 1 } });

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        table: { name: 'user' },
        where: {
          left: { table: 'user', column: 'id' },
          right: { kind: 'param', name: 'userId', index: 1 },
        },
        returning: [createColumnRef('user', 'id'), createColumnRef('user', 'email')],
      });
    });

    it('throws error if where is not called', () => {
      expect(() => {
        sql<Contract, CodecTypes>({ context }).delete(tables.user).build({ params: {} });
      }).toThrow('where() must be called before building a DELETE query');
    });

    it('throws error for missing parameter in where clause', () => {
      const userColumns = tables.user.columns;
      expect(() => {
        sql<Contract, CodecTypes>({ context })
          .delete(tables.user)
          .where(userColumns.id.eq(param('userId')))
          .build({ params: {} });
      }).toThrow('Missing value for parameter userId');
    });
  });
});
