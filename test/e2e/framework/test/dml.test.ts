import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestRuntime } from '@prisma-next/integration-tests/test/utils';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import {
  createStubAdapter,
  createTestContext,
  executePlanAndCollect,
} from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk, runDbInit } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../../../');
const configPath = resolve(__dirname, 'fixtures/prisma-next.config.ts');
const cliPath = resolve(repoRoot, 'packages/1-framework/3-tooling/cli/dist/cli.js');
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DML E2E Tests', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;
  let contract: Contract;
  let adapter: ReturnType<typeof createStubAdapter>;
  let context: ReturnType<typeof createTestContext<Contract>>;
  let tables: ReturnType<typeof schema<Contract>>['tables'];
  let builder: ReturnType<typeof sql<Contract>>;

  beforeAll(async () => {
    contract = await loadContractFromDisk<Contract>(contractJsonPath);
    adapter = createStubAdapter();
    context = createTestContext(contract, adapter);
    tables = schema(context).tables;
    builder = sql({ context });

    database = await createDevDatabase();
    // Run db init BEFORE connecting the client to avoid connection conflicts
    await runDbInit({ cliPath, configPath, dbUrl: database.connectionString, cwd: repoRoot });
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
  });

  beforeEach(async () => {
    await client.query('delete from "user"');
  }, timeouts.databaseOperation);

  it('inserts, updates, and deletes a user', async () => {
    const runtime = createTestRuntime(
      contract,
      {
        connect: { client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: true },
      },
    );

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

    type InsertRow = ResultType<typeof insertPlan>;
    const firstRow = insertRows[0] as InsertRow | undefined;
    if (!firstRow) {
      throw new Error('Expected insert to return at least one row');
    }
    const userId = firstRow.id;

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
