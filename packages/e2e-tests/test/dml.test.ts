import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import {
  createTestRuntime,
  executePlanAndCollect,
  setupTestDatabase,
} from '@prisma-next/runtime/test/utils';
import { param } from '@prisma-next/sql-query/param';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { createDevDatabase, teardownTestDatabase } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): SqlContract<SqlStorage> {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}

describe('DML E2E Tests', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let sharedDriver: ReturnType<typeof createPostgresDriverFromOptions>;
  let client: Client;
  const contract = loadContract('contract');
  const adapter = createPostgresAdapter();
  const tables = schema(contract).tables;
  const builder = sql({ contract, adapter });

  beforeAll(async () => {
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
          email TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL
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
        createdAt: param('createdAt'),
      })
      .returning(userColumns.id, userColumns.email)
      .build({
        params: {
          email: 'e2e@example.com',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      });

    const insertRows = await executePlanAndCollect(runtime, insertPlan);
    expect(insertRows.length).toBe(1);
    expect(insertRows[0]).toMatchObject({
      id: expect.any(Number),
      email: 'e2e@example.com',
    });

    const userId = (insertRows[0] as { id: number }).id;

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
