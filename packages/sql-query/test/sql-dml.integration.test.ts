import { param } from '@prisma-next/sql-query/param';
import { schema } from '@prisma-next/sql-query/schema';
import { validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import type { ResultType } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createPostgresDriverFromOptions } from '../../driver-postgres/src/postgres-driver';
import {
  createDevDatabase,
  teardownTestDatabase,
} from '@prisma-next/test-utils';
import {
  createTestRuntime,
  executePlanAndCollect,
  setupTestDatabase,
} from '../../runtime/test/utils';

const fixtureContractRaw: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:dml-test-core',
  profileHash: 'sha256:dml-test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          email: { type: 'pg/text@1', nullable: false },
          createdAt: { type: 'pg/timestamptz@1', nullable: false },
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
  mappings: {},
};
const fixtureContract = validateContract(fixtureContractRaw);

describe('DML Integration Tests', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: ReturnType<typeof createPostgresDriverFromOptions>;
  let client: Client;
  const adapter = createPostgresAdapter();
  const tables = schema(fixtureContract).tables;
  const builder = sql({ contract: fixtureContract, adapter });

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54020,
      databasePort: 54021,
      shadowDatabasePort: 54022,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    sharedDriver = createPostgresDriverFromOptions({
      connect: { client },
      cursor: { disabled: true },
    });
  });

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors
    }
  });

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
  });

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  });

  describe('insert', () => {
    it('inserts a row and returns it with returning clause', async () => {
      const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const userTable = tables.user;
      const userColumns = userTable.columns;

      const insertPlan = builder
        .insert(userTable, {
          email: param('email'),
          createdAt: param('createdAt'),
        })
        .returning(userColumns.id, userColumns.email, userColumns.createdAt)
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

    it('inserts a row without returning clause', async () => {
      const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const userTable = tables.user;

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
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await client.query('INSERT INTO "user" (email, "createdAt") VALUES ($1, $2)', [
        'original@example.com',
        new Date('2024-01-01T00:00:00Z'),
      ]);
    });

    it('updates a row and returns it with returning clause', async () => {
      const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const userTable = tables.user;
      const userColumns = userTable.columns;

      const updatePlan = builder
        .update(userTable, {
          email: param('newEmail'),
        })
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email)
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
    });

    it('updates a row without returning clause', async () => {
      const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const userTable = tables.user;
      const userColumns = userTable.columns;

      const updatePlan = builder
        .update(userTable, {
          email: param('newEmail'),
        })
        .where(userColumns.id.eq(param('userId')))
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
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await client.query('INSERT INTO "user" (email, "createdAt") VALUES ($1, $2), ($3, $4)', [
        'delete1@example.com',
        new Date('2024-01-01T00:00:00Z'),
        'delete2@example.com',
        new Date('2024-01-02T00:00:00Z'),
      ]);
    });

    it('deletes a row and returns it with returning clause', async () => {
      const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const userTable = tables.user;
      const userColumns = userTable.columns;

      const deletePlan = builder
        .delete(userTable)
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email)
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
    });

    it('deletes a row without returning clause', async () => {
      const runtime = createTestRuntime(fixtureContract, adapter, sharedDriver, {
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const userTable = tables.user;
      const userColumns = userTable.columns;

      const deletePlan = builder
        .delete(userTable)
        .where(userColumns.id.eq(param('userId')))
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
    });
  });
});

