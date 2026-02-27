import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { budgets, createRuntime, lints, type Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deleteWithoutWhere } from '../src/kysely/delete-without-where';
import { getAllPostsUnbounded } from '../src/kysely/get-all-posts-unbounded';
import { getUserById } from '../src/kysely/get-user-by-id';
import { getUserPosts } from '../src/kysely/get-user-posts';
import { getUsers } from '../src/kysely/get-users';
import { getUsersWithPosts } from '../src/kysely/get-users-with-posts';
import { updateWithoutWhere } from '../src/kysely/update-without-where';
import { demoStack, demoContext as executionContext } from '../src/prisma/context';
import { initTestDatabase } from './utils/control-client';

const { contract } = executionContext;

async function createTestDriver(connectionString: string, executionStack: typeof demoStack) {
  const driverDescriptor = executionStack.driver;
  if (!driverDescriptor) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const pool = new Pool({ connectionString });
  try {
    const driver = driverDescriptor.create({ connect: { pool }, cursor: { disabled: true } });
    if ('connect' in driver && typeof driver.connect === 'function') {
      await driver.connect({ kind: 'pgPool', pool });
    }
    return driver;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function getRuntime(connectionString: string): Promise<Runtime> {
  const executionStack = demoStack;
  return createRuntime({
    stackInstance: instantiateExecutionStack(executionStack),
    context: executionContext,
    driver: await createTestDriver(connectionString, executionStack),
    verify: { mode: 'onFirstUse', requireMarker: false },
    plugins: [
      lints(),
      budgets({
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { user: 10_000, post: 10_000 },
        maxLatencyMs: 1_000,
      }),
    ],
  });
}

async function seedTestData(
  runtime: Runtime,
  data: {
    users?: string[];
    posts?: Array<{ title: string; userIndex: number }>;
  },
): Promise<{ userIds: string[] }> {
  const tables = schema(executionContext).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;
  const userIds: string[] = [];

  if (data.users) {
    for (let i = 0; i < data.users.length; i++) {
      const email = data.users[i]!;
      const id = `user_${String(i + 1).padStart(3, '0')}`;
      const kind = i === 0 ? 'admin' : 'user';
      const plan = sql({ context: executionContext })
        .insert(userTable, {
          id: param('id'),
          email: param('email'),
          kind: param('kind'),
        })
        .returning(userTable.columns.id!)
        .build({ params: { id, email, kind } });

      type InsertedRow = ResultType<typeof plan>;
      for await (const row of runtime.execute(plan)) {
        userIds.push((row as InsertedRow).id!);
      }
    }
  }

  if (data.posts) {
    for (let i = 0; i < data.posts.length; i++) {
      const post = data.posts[i]!;
      const userId = userIds[post.userIndex];
      if (userId === undefined) continue;
      const id = `post_${String(i + 1).padStart(3, '0')}`;
      const plan = sql({ context: executionContext })
        .insert(postTable, {
          id: param('id'),
          title: param('title'),
          userId: param('userId'),
        })
        .build({ params: { id, title: post.title, userId } });

      for await (const _row of runtime.execute(plan)) {
        // consume
      }
    }
  }

  return { userIds };
}

describe('Kysely parity integration', () => {
  it(
    'getUserById returns user by id',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedTestData(runtime, { users: ['alice@example.com'] });
          const user = await getUserById('user_001', runtime);
          expect(user).toMatchObject({ email: 'alice@example.com' });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'getUserPosts returns posts for user',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedTestData(runtime, {
            users: ['alice@example.com'],
            posts: [{ title: 'First Post', userIndex: 0 }],
          });
          const posts = await getUserPosts('user_001', runtime);
          expect(posts).toHaveLength(1);
          expect(posts[0]!.title).toBe('First Post');
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'getUsers returns users with limit',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedTestData(runtime, {
            users: ['a@example.com', 'b@example.com', 'c@example.com'],
          });
          const users = await getUsers(runtime, 2);
          expect(users).toHaveLength(2);
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'getUsersWithPosts returns users with nested posts',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedTestData(runtime, {
            users: ['alice@example.com', 'bob@example.com'],
            posts: [
              { title: 'A1', userIndex: 0 },
              { title: 'A2', userIndex: 0 },
              { title: 'B1', userIndex: 1 },
            ],
          });
          const users = await getUsersWithPosts(runtime, 10);
          expect(users).toHaveLength(2);
          const alice = users.find((u) => u.email === 'alice@example.com')!;
          const bob = users.find((u) => u.email === 'bob@example.com')!;
          expect(alice).toMatchObject({ email: 'alice@example.com', posts: expect.any(Array) });
          expect(alice.posts).toHaveLength(2);
          expect(bob).toMatchObject({ email: 'bob@example.com', posts: expect.any(Array) });
          expect(bob.posts).toHaveLength(1);
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'guardrail blocks DELETE without WHERE',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await expect(deleteWithoutWhere(runtime)).rejects.toMatchObject({
            code: 'LINT.DELETE_WITHOUT_WHERE',
            category: 'LINT',
          });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'guardrail blocks UPDATE without WHERE',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await expect(updateWithoutWhere(runtime)).rejects.toMatchObject({
            code: 'LINT.UPDATE_WITHOUT_WHERE',
            category: 'LINT',
          });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'getAllPostsUnbounded triggers budget error when unbounded',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedTestData(runtime, {
            users: ['u@example.com'],
            posts: [{ title: 'P1', userIndex: 0 }],
          });
          await expect(getAllPostsUnbounded(runtime)).rejects.toMatchObject({
            code: 'BUDGET.ROWS_EXCEEDED',
            category: 'BUDGET',
          });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
