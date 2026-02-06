/** biome-ignore-all lint/style/noNonNullAssertion: non-null assertions are fine for tests */

import type { IncludeChildBuilder, JoinOnBuilder } from '@prisma-next/sql-lane';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { budgets, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { describe, expect, it } from 'vitest';
import { executionContext, executionStackInstance } from '../src/prisma/execution-context';
import { getRuntime } from '../src/prisma/runtime';
import { initTestDatabase } from './utils/control-client';
import { withTempSqliteDatabase } from './utils/with-temp-sqlite-db';

const { contract } = executionContext;

/**
 * Seeds test data using the runtime and query DSL.
 * Uses column defaults for id (autoincrement) and createdAt (now).
 */
async function seedTestData(
  runtime: Runtime,
  data: {
    users?: string[];
    posts?: Array<{ title: string; userIndex: number }>;
  },
): Promise<{ userIds: number[] }> {
  const tables = schema(executionContext).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;

  const userIds: number[] = [];

  // Insert users (omit id and createdAt - they have defaults)
  if (data.users) {
    for (let i = 0; i < data.users.length; i++) {
      const email = data.users[i]!;

      const plan = sql({ context: executionContext })
        .insert(userTable, {
          email: param('email'),
        })
        .returning(userTable.columns['id']!)
        .build({ params: { email } });

      type InsertedRow = ResultType<typeof plan>;
      for await (const row of runtime.execute(plan)) {
        userIds.push((row as InsertedRow)['id']!);
      }
    }
  }

  // Insert posts (omit id and createdAt - they have defaults)
  if (data.posts) {
    for (let i = 0; i < data.posts.length; i++) {
      const post = data.posts[i]!;
      const userId = userIds[post.userIndex];
      if (userId === undefined) continue;

      const plan = sql({ context: executionContext })
        .insert(postTable, {
          title: param('title'),
          userId: param('userId'),
        })
        .build({ params: { title: post.title, userId } });

      for await (const _row of runtime.execute(plan)) {
        // consume iterator
      }
    }
  }

  return { userIds };
}

describe('runtime execute integration', () => {
  it('streams rows and enforces marker verification', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      // Initialize schema and marker using control client
      await initTestDatabase({
        connection: connectionString,
        contractIR: contract,
      });

      const context = executionContext;
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const root = sql({ context: executionContext });
      const plan = root
        .from(userTable)
        .select({
          id: userTable.columns['id']!,
          email: userTable.columns['email']!,
        })
        .limit(10)
        .build();

      const templatePlan = root.raw.with({ annotations: { limit: 1 } })`
          select id, email from "user"
          where email = ${'alice@example.com'}
          limit ${1}
        `;

      const functionPlan = root.raw('select id from "user" where email = $1 limit $2', {
        params: ['alice@example.com', 1],
        refs: {
          tables: ['user'],
          columns: [{ table: 'user', column: 'email' }],
        },
        annotations: { intent: 'report', limit: 1 },
      });

      const createRuntimeInstance = () => {
        return createRuntime({
          stackInstance: executionStackInstance,
          contract,
          context,
          driverOptions: {
            connect: { filename: connectionString },
          },
          verify: { mode: 'always', requireMarker: true },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });
      };

      // Seed data using a runtime instance
      const seedRuntime = createRuntimeInstance();
      try {
        await seedTestData(seedRuntime, {
          users: ['alice@example.com'],
        });
      } finally {
        await seedRuntime.close();
      }

      const runtime = createRuntimeInstance();
      try {
        type PlanRow = ResultType<typeof plan>;
        const rows: PlanRow[] = [];
        for await (const row of runtime.execute(plan)) {
          rows.push(row as PlanRow);
        }

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ email: 'alice@example.com' });

        type TemplatePlanRow = ResultType<typeof templatePlan>;
        const templateRows: TemplatePlanRow[] = [];
        for await (const row of runtime.execute(templatePlan)) {
          templateRows.push(row);
        }
        expect(templateRows).toHaveLength(1);

        type FunctionPlanRow = ResultType<typeof functionPlan>;
        const functionRows: FunctionPlanRow[] = [];
        for await (const row of runtime.execute(functionPlan)) {
          functionRows.push(row);
        }
        expect(functionRows).toHaveLength(1);
      } finally {
        await runtime.close();
      }

      // Test marker mismatch detection - create a new runtime with wrong marker expectation
      // Note: We can't easily test this without modifying the marker, so we skip this part
      // as it would require low-level database access which we're trying to avoid
    });
  });

  it('infers correct types from query plans', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      await initTestDatabase({
        connection: connectionString,
        contractIR: contract,
      });
      const runtime = getRuntime(connectionString);

      try {
        // Seed data
        await seedTestData(runtime, {
          users: ['alice@example.com'],
          posts: [{ title: 'First Post', userIndex: 0 }],
        });

        const context = executionContext;
        const tables = schema(context).tables;
        const userTable = tables['user']!;
        const postTable = tables['post']!;

        const userPlan = sql({ context: executionContext })
          .from(userTable)
          .select({
            id: userTable.columns['id']!,
            email: userTable.columns['email']!,
            createdAt: userTable.columns['createdAt']!,
          })
          .limit(10)
          .build();

        type UserRow = ResultType<typeof userPlan>;

        const postPlan = sql({ context: executionContext })
          .from(postTable)
          .where(postTable.columns['userId']!.eq(param('userId')))
          .select({
            id: postTable.columns['id']!,
            title: postTable.columns['title']!,
            userId: postTable.columns['userId']!,
            createdAt: postTable.columns['createdAt']!,
          })
          .limit(1)
          .build({ params: { userId: 1 } });

        type PostRow = ResultType<typeof postPlan>;

        const userRows: UserRow[] = [];
        for await (const row of runtime.execute(userPlan)) {
          userRows.push(row as UserRow);
        }
        expect(userRows).toHaveLength(1);
        expect(userRows[0]).toMatchObject({ email: 'alice@example.com' });

        const postRows: PostRow[] = [];
        for await (const row of runtime.execute(postPlan)) {
          postRows.push(row as PostRow);
        }
        expect(postRows).toHaveLength(1);
        expect(postRows[0]).toMatchObject({
          title: 'First Post',
          userId: 1,
        });
      } finally {
        await runtime.close();
      }
    });
  });

  it('enforces row budget on unbounded queries', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      await initTestDatabase({
        connection: connectionString,
        contractIR: contract,
      });

      const context = executionContext;
      const runtime = createRuntime({
        stackInstance: executionStackInstance,
        contract,
        context,
        driverOptions: {
          connect: { filename: connectionString },
        },
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 50,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000, post: 10_000 },
          }),
        ],
      });

      try {
        // Seed 100 users using a separate runtime without strict budgets
        const seedRuntime = getRuntime(connectionString);
        try {
          const emails = Array.from({ length: 100 }, (_, i) => `user${i}@example.com`);
          await seedTestData(seedRuntime, { users: emails });
        } finally {
          await seedRuntime.close();
        }

        const tables = schema(context).tables;
        const userTable = tables['user']!;
        const unboundedPlan = sql({ context: executionContext })
          .from(tables['user']!)
          .select({
            id: userTable.columns['id']!,
            email: userTable.columns['email']!,
          })
          .build();

        await expect(async () => {
          for await (const _row of runtime.execute(unboundedPlan)) {
            // Should not reach here
          }
        }).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
        });

        const boundedPlan = sql({ context: executionContext })
          .from(tables['user']!)
          .select({
            id: userTable.columns['id']!,
            email: userTable.columns['email']!,
          })
          .limit(10)
          .build();

        type BoundedPlanRow = ResultType<typeof boundedPlan>;
        const rows: BoundedPlanRow[] = [];
        for await (const row of runtime.execute(boundedPlan)) {
          rows.push(row);
        }
        expect(rows.length).toBeLessThanOrEqual(10);
      } finally {
        await runtime.close();
      }
    });
  });

  it('enforces streaming row budget', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      await initTestDatabase({
        connection: connectionString,
        contractIR: contract,
      });

      const context = executionContext;
      const runtime = createRuntime({
        stackInstance: executionStackInstance,
        contract,
        context,
        driverOptions: {
          connect: { filename: connectionString },
        },
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000, post: 10_000 },
          }),
        ],
      });

      try {
        // Seed 50 users using a separate runtime without strict budgets
        const seedRuntime = getRuntime(connectionString);
        try {
          const emails = Array.from({ length: 50 }, (_, i) => `user${i}@example.com`);
          await seedTestData(seedRuntime, { users: emails });
        } finally {
          await seedRuntime.close();
        }

        const tables = schema(context).tables;
        const userTable = tables['user']!;
        const plan = sql({ context: executionContext })
          .from(tables['user']!)
          .select({
            id: userTable.columns['id']!,
            email: userTable.columns['email']!,
          })
          .limit(50)
          .build();

        await expect(async () => {
          for await (const _row of runtime.execute(plan)) {
            // Will throw on 11th row
          }
        }).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
        });
      } finally {
        await runtime.close();
      }
    });
  });

  it('includeMany returns users with nested posts array', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      await initTestDatabase({
        connection: connectionString,
        contractIR: contract,
      });
      const runtime = getRuntime(connectionString);

      try {
        // Seed users and posts
        await seedTestData(runtime, {
          users: ['alice@example.com', 'bob@example.com'],
          posts: [
            { title: 'First Post', userIndex: 0 },
            { title: 'Second Post', userIndex: 0 },
            { title: 'Third Post', userIndex: 1 },
          ],
        });

        const context = executionContext;
        const tables = schema(context).tables;
        const userTable = tables['user']!;
        const postTable = tables['post']!;

        const plan = sql({ context: executionContext })
          .from(userTable)
          .includeMany(
            postTable,
            (on: JoinOnBuilder) => on.eqCol(userTable.columns['id']!, postTable.columns['userId']!),
            (child: IncludeChildBuilder) =>
              child
                .select({
                  id: postTable.columns['id']!,
                  title: postTable.columns['title']!,
                  createdAt: postTable.columns['createdAt']!,
                })
                .orderBy(postTable.columns['createdAt']!.desc()),
            { alias: 'posts' },
          )
          .select({
            id: userTable.columns['id']!,
            email: userTable.columns['email']!,
            createdAt: userTable.columns['createdAt']!,
            posts: true,
          })
          .limit(10)
          .build();

        type Row = ResultType<typeof plan>;
        const rows: Row[] = [];
        for await (const row of runtime.execute(plan)) {
          rows.push(row);
        }

        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveProperty('id');
        expect(rows[0]).toHaveProperty('email');
        expect(rows[0]).toHaveProperty('posts');
        expect(Array.isArray(rows[0]!.posts)).toBe(true);

        const alice = rows.find((r) => r.email === 'alice@example.com');
        expect(alice).toBeDefined();
        expect(alice!.posts).toHaveLength(2);
        expect(alice!.posts[0]).toHaveProperty('id');
        expect(alice!.posts[0]).toHaveProperty('title');
        expect(alice!.posts[0]).toHaveProperty('createdAt');
        expect(typeof alice!.posts[0]!.id).toBe('number');
        expect(typeof alice!.posts[0]!.title).toBe('string');

        const bob = rows.find((r) => r.email === 'bob@example.com');
        expect(bob).toBeDefined();
        expect(bob!.posts).toHaveLength(1);
        expect(bob!.posts[0]!.title).toBe('Third Post');
      } finally {
        await runtime.close();
      }
    });
  });
});
