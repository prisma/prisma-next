import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { createRuntimeContext } from '@prisma-next/runtime';
import {
  createTestRuntime,
  executePlanAndCollect,
  setupTestDatabase,
} from '@prisma-next/runtime/test/utils';
import { param } from '@prisma-next/sql-query/param';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { createDevDatabase, teardownTestDatabase } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DML E2E Tests', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: ReturnType<typeof createPostgresDriverFromOptions>;
  let client: Client;
  let contract: Contract;
  let adapter: ReturnType<typeof createPostgresAdapter>;
  let context: ReturnType<typeof createRuntimeContext<Contract>>;
  let tables: ReturnType<typeof schema<Contract>>['tables'];
  let builder: ReturnType<typeof sql<Contract>>;

  beforeAll(async () => {
    contract = await loadContractFromDisk<Contract>(contractJsonPath);
    adapter = createPostgresAdapter();
    context = createRuntimeContext({ contract, adapter, extensions: [] });
    tables = schema(context).tables;
    builder = sql({ context });

    database = await createDevDatabase({
      acceleratePort: 54030,
      databasePort: 54031,
      shadowDatabasePort: 54032,
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
    await setupTestDatabase(client, contract, async (c: typeof client) => {
      await c.query('DROP TABLE IF EXISTS "user"');
      await c.query(`
        CREATE TABLE "user" (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL
        )
      `);
    });
  });

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  });

  it('inserts, updates, and deletes a user', async () => {
    const runtime = createTestRuntime(contract, adapter, sharedDriver, {
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    const userTable = tables.user;
    const userColumns = userTable.columns;

    // Insert
    const insertPlan = builder
      .insert(userTable, {
        email: param('email'),
      })
      .returning(userColumns.id, userColumns.email)
      .build({
        params: {
          email: 'e2e@example.com',
        },
      });

    const insertRows = await executePlanAndCollect(runtime, insertPlan);
    expect(insertRows.length).toBe(1);
    expect(insertRows[0]).toMatchObject({
      id: expect.any(Number),
      email: 'e2e@example.com',
    });

    const userId = insertRows[0]?.id;
    if (userId === undefined) {
      throw new Error('Expected insert to return id');
    }

    // Update
    const updatePlan = builder
      .update(userTable, {
        email: param('newEmail'),
      })
      .where(userColumns.id.eq(param('userId')))
      .returning(userColumns.id, userColumns.email)
      .build({
        params: {
          newEmail: 'updated-e2e@example.com',
          userId,
        },
      });

    const updateRows = await executePlanAndCollect(runtime, updatePlan);
    expect(updateRows.length).toBe(1);
    expect(updateRows[0]).toMatchObject({
      id: userId,
      email: 'updated-e2e@example.com',
    });

    // Delete
    const deletePlan = builder
      .delete(userTable)
      .where(userColumns.id.eq(param('userId')))
      .returning(userColumns.id, userColumns.email)
      .build({
        params: {
          userId,
        },
      });

    const deleteRows = await executePlanAndCollect(runtime, deletePlan);
    expect(deleteRows.length).toBe(1);
    expect(deleteRows[0]).toMatchObject({
      id: userId,
      email: 'updated-e2e@example.com',
    });

    // Verify deleted
    const selectResult = await client.query('SELECT * FROM "user" WHERE id = $1', [userId]);
    expect(selectResult.rows.length).toBe(0);
  });
});
