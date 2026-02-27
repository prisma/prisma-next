import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { ResultType } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { createTestContext, executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, teardownTestDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestRuntime, setupTestDatabase } from './utils';

const fixtureContractRaw: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:dml-test-core'),
  profileHash: profileHash('sha256:dml-test-profile'),
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          createdAt: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: false },
        },
        primaryKey: {
          columns: ['id'],
          name: 'user_pkey',
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
  capabilities: {
    postgres: {
      returning: true,
    },
  },
  extensionPacks: {},
  meta: {},
  sources: {},
};
const fixtureContract = validateContract(fixtureContractRaw);

describe('DML Integration Tests', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;
  const adapter = createPostgresAdapter();

  beforeAll(async () => {
    database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors
    }
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    await setupTestDatabase(client, fixtureContract, async (c: typeof client) => {
      await c.query('DROP TABLE IF EXISTS "user"');
      await c.query(`
        CREATE TABLE "user" (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL
        )
      `);
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  }, timeouts.spinUpPpgDev);

  describe('insert', () => {
    it('inserts a row and returns it with returning clause', async () => {
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: true },
        },
      );

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const builder = sql({ context });
      const userTable = tables['user'];
      if (!userTable) {
        throw new Error('user table not found');
      }
      const userColumns = userTable.columns;
      const idCol = userColumns['id'];
      const emailCol = userColumns['email'];
      const createdAtCol = userColumns['createdAt'];
      if (!idCol || !emailCol || !createdAtCol) {
        throw new Error('Required columns not found');
      }

      const insertPlan = builder
        .insert(userTable, {
          email: param('email'),
          createdAt: param('createdAt'),
        })
        .returning(idCol as ColumnBuilder, emailCol as ColumnBuilder, createdAtCol as ColumnBuilder)
        .build({
          params: {
            email: 'test@example.com',
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
        });

      type Row = ResultType<typeof insertPlan>;
      const rows: Row[] = await executePlanAndCollect(runtime, insertPlan);

      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        id: expect.any(Number),
        email: 'test@example.com',
        createdAt: expect.any(String),
      });
    });

    it(
      'inserts a row without returning clause',
      async () => {
        const runtime = await createTestRuntime(
          fixtureContract,
          {
            binding: { kind: 'pgClient', client },
            cursor: { disabled: true },
          },
          {
            verify: { mode: 'onFirstUse', requireMarker: true },
          },
        );

        const context = createTestContext(fixtureContract, adapter);
        const tables = schema(context).tables;
        const builder = sql({ context });
        const userTable = tables['user'];
        if (!userTable) {
          throw new Error('user table not found');
        }

        const insertPlan = builder
          .insert(userTable, {
            email: param('email'),
            createdAt: param('createdAt'),
          })
          .build({
            params: {
              email: 'test2@example.com',
              createdAt: new Date('2024-01-02T00:00:00Z'),
            },
          });

        const rows = await executePlanAndCollect(runtime, insertPlan);

        expect(rows.length).toBe(0);

        const selectResult = await client.query('SELECT * FROM "user" WHERE email = $1', [
          'test2@example.com',
        ]);
        expect(selectResult.rows.length).toBe(1);
        expect(selectResult.rows[0].email).toBe('test2@example.com');
      },
      timeouts.databaseOperation,
    );
  });

  describe('update', () => {
    beforeEach(async () => {
      await client.query('INSERT INTO "user" (email, "createdAt") VALUES ($1, $2)', [
        'original@example.com',
        new Date('2024-01-01T00:00:00Z'),
      ]);
    }, timeouts.spinUpPpgDev);

    it(
      'updates a row and returns it with returning clause',
      async () => {
        const runtime = await createTestRuntime(
          fixtureContract,
          {
            binding: { kind: 'pgClient', client },
            cursor: { disabled: true },
          },
          {
            verify: { mode: 'onFirstUse', requireMarker: true },
          },
        );

        const context = createTestContext(fixtureContract, adapter);
        const tables = schema(context).tables;
        const builder = sql({ context });
        const userTable = tables['user'];
        if (!userTable) {
          throw new Error('user table not found');
        }
        const userColumns = userTable.columns;
        const idCol = userColumns['id'];
        const emailCol = userColumns['email'];
        if (!idCol || !emailCol) {
          throw new Error('Required columns not found');
        }

        const updatePlan = builder
          .update(userTable, {
            email: param('newEmail'),
          })
          .where(idCol.eq(param('userId')))
          .returning(idCol as ColumnBuilder, emailCol as ColumnBuilder)
          .build({
            params: {
              newEmail: 'updated@example.com',
              userId: 1,
            },
          });

        type Row = ResultType<typeof updatePlan>;
        const rows: Row[] = await executePlanAndCollect(runtime, updatePlan);

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          id: 1,
          email: 'updated@example.com',
        });

        const selectResult = await client.query('SELECT * FROM "user" WHERE id = $1', [1]);
        expect(selectResult.rows[0].email).toBe('updated@example.com');
      },
      timeouts.databaseOperation,
    );

    it(
      'updates a row without returning clause',
      async () => {
        const runtime = await createTestRuntime(
          fixtureContract,
          {
            binding: { kind: 'pgClient', client },
            cursor: { disabled: true },
          },
          {
            verify: { mode: 'onFirstUse', requireMarker: true },
          },
        );

        const context = createTestContext(fixtureContract, adapter);
        const tables = schema(context).tables;
        const builder = sql({ context });
        const userTable = tables['user'];
        if (!userTable) {
          throw new Error('user table not found');
        }
        const userColumns = userTable.columns;
        const idCol = userColumns['id'];
        if (!idCol) {
          throw new Error('Required column not found');
        }

        const updatePlan = builder
          .update(userTable, {
            email: param('newEmail'),
          })
          .where(idCol.eq(param('userId')))
          .build({
            params: {
              newEmail: 'updated2@example.com',
              userId: 1,
            },
          });

        const rows = await executePlanAndCollect(runtime, updatePlan);

        expect(rows.length).toBe(0);

        const selectResult = await client.query('SELECT * FROM "user" WHERE id = $1', [1]);
        expect(selectResult.rows[0].email).toBe('updated2@example.com');
      },
      timeouts.databaseOperation,
    );
  });

  describe('delete', () => {
    beforeEach(async () => {
      await client.query('INSERT INTO "user" (email, "createdAt") VALUES ($1, $2), ($3, $4)', [
        'delete1@example.com',
        new Date('2024-01-01T00:00:00Z'),
        'delete2@example.com',
        new Date('2024-01-02T00:00:00Z'),
      ]);
    }, timeouts.spinUpPpgDev);

    it(
      'deletes a row and returns it with returning clause',
      async () => {
        const runtime = await createTestRuntime(
          fixtureContract,
          {
            binding: { kind: 'pgClient', client },
            cursor: { disabled: true },
          },
          {
            verify: { mode: 'onFirstUse', requireMarker: true },
          },
        );

        const context = createTestContext(fixtureContract, adapter);
        const tables = schema(context).tables;
        const builder = sql({ context });
        const userTable = tables['user'];
        if (!userTable) {
          throw new Error('user table not found');
        }
        const userColumns = userTable.columns;
        const idCol = userColumns['id'];
        const emailCol = userColumns['email'];
        if (!idCol || !emailCol) {
          throw new Error('Required columns not found');
        }

        const deletePlan = builder
          .delete(userTable)
          .where(idCol.eq(param('userId')))
          .returning(idCol as ColumnBuilder, emailCol as ColumnBuilder)
          .build({
            params: {
              userId: 1,
            },
          });

        type Row = ResultType<typeof deletePlan>;
        const rows: Row[] = await executePlanAndCollect(runtime, deletePlan);

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          id: 1,
          email: 'delete1@example.com',
        });

        const selectResult = await client.query('SELECT * FROM "user"');
        expect(selectResult.rows.length).toBe(1);
        expect(selectResult.rows[0].email).toBe('delete2@example.com');
      },
      timeouts.databaseOperation,
    );

    it(
      'deletes a row without returning clause',
      async () => {
        const runtime = await createTestRuntime(
          fixtureContract,
          {
            binding: { kind: 'pgClient', client },
            cursor: { disabled: true },
          },
          {
            verify: { mode: 'onFirstUse', requireMarker: true },
          },
        );

        const context = createTestContext(fixtureContract, adapter);
        const tables = schema(context).tables;
        const builder = sql({ context });
        const userTable = tables['user'];
        if (!userTable) {
          throw new Error('user table not found');
        }
        const userColumns = userTable.columns;
        const idCol = userColumns['id'];
        if (!idCol) {
          throw new Error('Required column not found');
        }

        const deletePlan = builder
          .delete(userTable)
          .where(idCol.eq(param('userId')))
          .build({
            params: {
              userId: 1,
            },
          });

        const rows = await executePlanAndCollect(runtime, deletePlan);

        expect(rows.length).toBe(0);

        const selectResult = await client.query('SELECT * FROM "user"');
        expect(selectResult.rows.length).toBe(1);
        expect(selectResult.rows[0].email).toBe('delete2@example.com');
      },
      timeouts.databaseOperation,
    );
  });
});
