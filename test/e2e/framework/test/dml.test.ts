import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DML E2E Tests', { timeout: 30000 }, () => {
  it('inserts, updates, and deletes a user', async () => {
    await withTestRuntime<Contract>(
      contractJsonPath,
      async ({ tables, runtime, context, client }) => {
        const userTable = tables.user!;
        const userColumns = userTable.columns;
        const builder = sql({ context });

        // Insert
        const insertPlan = builder
          .insert(userTable, {
            email: param('email'),
          })
          .returning(
            userColumns.id!,
            userColumns.email,
            userColumns.created_at!,
            userColumns.update_at,
          )
          .build({
            params: {
              email: 'e2e@example.com',
            },
          });

        const insertRows = await executePlanAndCollect(runtime, insertPlan);
        type InsertRow = ResultType<typeof insertPlan>;
        expect(insertRows.length).toBe(1);
        expect(insertRows[0]).toMatchObject({
          id: expect.any(Number),
          email: 'e2e@example.com',
          // Note: dates are currently interpreted as strings, e.g., "2026-01-30T13:29:22.101Z"
          created_at: expect.any(String),
          update_at: null,
        });

        const firstRow = insertRows[0] as InsertRow | undefined;
        const userId = firstRow?.id;
        if (userId === undefined) {
          throw new Error('Expected insert to return id');
        }

        // Update
        const updatePlan = builder
          .update(userTable, {
            email: param('newEmail'),
          })
          .where(userColumns.id!.eq(param('userId')))
          .returning(
            userColumns.id!,
            userColumns.email!,
            userColumns.created_at!,
            userColumns.update_at,
          )
          .build({
            params: {
              newEmail: 'updated-e2e@example.com',
              userId,
              // Note: dates are currently interpreted as strings, e.g., "2026-01-30T13:29:22.101Z"
              created_at: expect.any(String),
              update_at: null,
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
      },
    );
  });
});
