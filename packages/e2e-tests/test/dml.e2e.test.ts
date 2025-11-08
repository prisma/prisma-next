import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createRuntimeContext } from '@prisma-next/runtime';
import { param } from '@prisma-next/sql-query/param';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  createTestRuntimeFromClient,
  executePlanAndCollect,
  setupE2EDatabase,
} from '../../runtime/test/utils';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DML E2E Tests', { timeout: 30000 }, () => {
  it('inserts, updates, and deletes a user', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: { connectionString: string }) => {
        await withClient(connectionString, async (client: import('pg').Client) => {
          await setupE2EDatabase(client, contract, async (c: typeof client) => {
            await c.query('DROP TABLE IF EXISTS "user"');
            await c.query('CREATE TABLE "user" (id SERIAL PRIMARY KEY, email TEXT NOT NULL)');
          });

          const adapter = createPostgresAdapter();
          const context = createRuntimeContext({ contract, adapter, extensions: [] });
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract>(context).tables;
            const userTable = tables.user!;
            const userColumns = userTable.columns;
            const builder = sql({ context });

            // Insert
            const insertPlan = builder
              .insert(userTable, {
                email: param('email'),
              })
              .returning(userColumns.id!, userColumns.email!)
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

            const userId = (insertRows[0] as { id: number }).id;

            // Update
            const updatePlan = builder
              .update(userTable, {
                email: param('newEmail'),
              })
              .where(userColumns.id!.eq(param('userId')))
              .returning(userColumns.id!, userColumns.email!)
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
              .where(userColumns.id!.eq(param('userId')))
              .returning(userColumns.id!, userColumns.email!)
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
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54030, databasePort: 54031, shadowDatabasePort: 54032 },
    );
  });
});
