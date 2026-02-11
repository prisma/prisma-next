import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
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

  it('supports typed jsonb/json values in insert and select clauses', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ tables, runtime, context }) => {
      const userTable = tables.user!;
      const postTable = tables.post!;
      const builder = sql({ context });

      const profile = {
        displayName: 'e2e',
        tags: ['typed', 'json'],
        active: true,
      } as const;
      const meta = {
        source: 'dml-test',
        rank: 10,
        verified: true,
      } as const;

      const insertUserPlan = builder
        .insert(userTable, {
          email: param('email'),
          profile: param('profile'),
        })
        .returning(userTable.columns.id!, userTable.columns.profile!)
        .build({
          params: {
            email: 'json@example.com',
            profile,
          },
        });

      const userRows = await executePlanAndCollect(runtime, insertUserPlan);
      expect(userRows).toHaveLength(1);
      expect(userRows[0]).toMatchObject({ profile });

      const insertedUser = userRows[0];
      if (!insertedUser) {
        throw new Error('Expected inserted user row');
      }

      const insertPostPlan = builder
        .insert(postTable, {
          userId: param('userId'),
          title: param('title'),
          published: param('published'),
          meta: param('meta'),
        })
        .returning(postTable.columns.id!, postTable.columns.meta!)
        .build({
          params: {
            userId: insertedUser.id,
            title: 'Typed JSON post',
            published: true,
            meta,
          },
        });

      const postRows = await executePlanAndCollect(runtime, insertPostPlan);
      expect(postRows).toHaveLength(1);
      expect(postRows[0]).toMatchObject({ meta });

      const insertedPost = postRows[0];
      if (!insertedPost) {
        throw new Error('Expected inserted post row');
      }

      const selectPlan = builder
        .from(postTable)
        .where(postTable.columns.id!.eq(param('postId')))
        .select({
          id: postTable.columns.id!,
          meta: postTable.columns.meta!,
        })
        .build({ params: { postId: insertedPost.id } });

      type SelectRow = ResultType<typeof selectPlan>;
      expectTypeOf<SelectRow['meta']>().toExtend<{
        readonly source: string;
        readonly rank: number;
        readonly verified: boolean;
      } | null>();

      const selectedRows = await executePlanAndCollect(runtime, selectPlan);
      expect(selectedRows).toHaveLength(1);
      expect(selectedRows[0]).toMatchObject({ meta });
    });
  });
});
