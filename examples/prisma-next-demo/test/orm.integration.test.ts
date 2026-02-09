import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { executionContext } from '../src/prisma/context';
import { getRuntime } from '../src/prisma/runtime';
import { initTestDatabase } from './utils/control-client';

const { contract } = executionContext;

/**
 * Seeds test data using the runtime and query DSL.
 */
async function seedTestData(
  runtime: Runtime,
  data: { users?: string[]; posts?: Array<{ title: string; userIndex: number }> },
): Promise<{ userIds: number[] }> {
  const tables = schema(executionContext).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;

  const userIds: number[] = [];

  // Insert users (provide all required columns since contract doesn't have defaults)
  if (data.users) {
    for (let i = 0; i < data.users.length; i++) {
      const email = data.users[i]!;
      const id = i + 1;
      const createdAt = new Date();
      const kind = i === 0 ? 'admin' : 'user';

      const plan = sql({ context: executionContext })
        .insert(userTable, {
          id: param('id'),
          email: param('email'),
          createdAt: param('createdAt'),
          kind: param('kind'),
        })
        .returning(userTable.columns['id']!)
        .build({ params: { id, email, createdAt, kind } });

      for await (const row of runtime.execute(plan)) {
        userIds.push((row as { id: number }).id);
      }
    }
  }

  // Insert posts (provide all required columns)
  if (data.posts) {
    for (let i = 0; i < data.posts.length; i++) {
      const post = data.posts[i]!;
      const userId = userIds[post.userIndex];
      if (userId === undefined) continue;

      const id = i + 1;
      const createdAt = new Date();

      const plan = sql({ context: executionContext })
        .insert(postTable, {
          id: param('id'),
          title: param('title'),
          userId: param('userId'),
          createdAt: param('createdAt'),
        })
        .build({ params: { id, title: post.title, userId, createdAt } });

      for await (const _row of runtime.execute(plan)) {
        // consume iterator
      }
    }
  }

  return { userIds };
}

describe('ORM integration tests', () => {
  it(
    'orm.getUsers returns users with selected fields, respects limit and ordering',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        // Initialize schema using control client
        await initTestDatabase({ connection: connectionString, contractIR: contract });

        const runtime = getRuntime(connectionString);
        try {
          // Seed data using runtime
          await seedTestData(runtime, {
            users: ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
          });

          const { ormGetUsers } = await import('../src/queries/orm-get-users');
          const users = await ormGetUsers(2, runtime);

          expect(users).toHaveLength(2);
          expect(users[0]).toMatchObject({
            id: expect.any(Number),
            email: expect.any(String),
            createdAt: expect.anything(),
          });
          expect(users[0]).not.toMatchObject({ posts: expect.anything() });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'orm.getUserById returns single user by ID',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedTestData(runtime, { users: ['alice@example.com'] });

          const { ormGetUserById } = await import('../src/queries/orm-get-user-by-id');
          const user = await ormGetUserById(1, runtime);

          expect(user).not.toBeNull();
          expect(user).toMatchObject({
            id: 1,
            email: 'alice@example.com',
            createdAt: expect.anything(),
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm relation filters: where.related.posts.some() returns users with at least one post',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedTestData(runtime, {
            users: ['alice@example.com', 'bob@example.com'],
            posts: [{ title: 'First Post', userIndex: 0 }],
          });

          const { ormGetUsersWithPosts } = await import('../src/queries/orm-relation-filters');
          const users = await ormGetUsersWithPosts(runtime);

          expect(users.length).toBeGreaterThan(0);
          expect(users[0]).toMatchObject({
            id: expect.anything(),
            email: expect.anything(),
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm includes: include.posts() returns users with nested posts arrays',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedTestData(runtime, {
            users: ['alice@example.com', 'bob@example.com'],
            posts: [
              { title: 'First Post', userIndex: 0 },
              { title: 'Second Post', userIndex: 0 },
              { title: 'Third Post', userIndex: 1 },
            ],
          });

          const { ormGetUsersWithPosts } = await import('../src/queries/orm-includes');
          const users = await ormGetUsersWithPosts(10, runtime);

          expect(users.length).toBeGreaterThan(0);
          expect(users[0]).toMatchObject({
            id: expect.anything(),
            email: expect.anything(),
            posts: expect.any(Array),
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: create() inserts a user',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          const { ormCreateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormCreateUser(
            { id: 1, email: 'alice@example.com', createdAt: new Date(), kind: 'admin' },
            runtime,
          );

          expect(affectedRows).toBe(1);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: update() updates a user',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedTestData(runtime, { users: ['alice@example.com'] });

          const { ormUpdateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormUpdateUser(1, 'alice-updated@example.com', runtime);

          expect(affectedRows).toBe(1);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: delete() deletes a user',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedTestData(runtime, { users: ['alice@example.com'] });

          const { ormDeleteUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormDeleteUser(1, runtime);

          expect(affectedRows).toBe(1);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm pagination: ormGetUsersByIdCursor returns paginated users with gt cursor',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          const emails = Array.from({ length: 10 }, (_, i) => `user${i + 1}@example.com`);
          await seedTestData(runtime, { users: emails });

          const { ormGetUsersByIdCursor } = await import('../src/queries/orm-pagination');

          const firstPage = await ormGetUsersByIdCursor(null, 3, runtime);
          expect(firstPage).toHaveLength(3);
          expect(firstPage.map((u) => u.id)).toEqual([1, 2, 3]);

          const secondPage = await ormGetUsersByIdCursor(3, 3, runtime);
          expect(secondPage).toHaveLength(3);
          expect(secondPage.map((u) => u.id)).toEqual([4, 5, 6]);

          const thirdPage = await ormGetUsersByIdCursor(6, 3, runtime);
          expect(thirdPage).toHaveLength(3);
          expect(thirdPage.map((u) => u.id)).toEqual([7, 8, 9]);

          const lastPage = await ormGetUsersByIdCursor(9, 3, runtime);
          expect(lastPage).toHaveLength(1);
          expect(lastPage.map((u) => u.id)).toEqual([10]);

          const emptyPage = await ormGetUsersByIdCursor(10, 3, runtime);
          expect(emptyPage).toHaveLength(0);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm pagination: ormGetUsersBackward returns users before cursor with lt operator',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          const emails = Array.from({ length: 10 }, (_, i) => `user${i + 1}@example.com`);
          await seedTestData(runtime, { users: emails });

          const { ormGetUsersBackward } = await import('../src/queries/orm-pagination');

          const page = await ormGetUsersBackward(8, 3, runtime);
          expect(page).toHaveLength(3);
          expect(page.map((u) => u.id)).toEqual([7, 6, 5]);

          const earlierPage = await ormGetUsersBackward(4, 3, runtime);
          expect(earlierPage).toHaveLength(3);
          expect(earlierPage.map((u) => u.id)).toEqual([3, 2, 1]);

          const partialPage = await ormGetUsersBackward(2, 3, runtime);
          expect(partialPage).toHaveLength(1);
          expect(partialPage.map((u) => u.id)).toEqual([1]);

          const emptyPage = await ormGetUsersBackward(1, 3, runtime);
          expect(emptyPage).toHaveLength(0);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
