import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { executionContext } from '../src/prisma/context';
import { getRuntime } from '../src/prisma/runtime';
import { repositoryGetAdminUsers } from '../src/repositories/get-admin-users';
import { repositoryGetUserPosts } from '../src/repositories/get-user-posts';
import { repositoryGetUsers } from '../src/repositories/get-users';
import { initTestDatabase } from './utils/control-client';

const { contract } = executionContext;

async function seedRepositoryData(runtime: Runtime): Promise<void> {
  const tables = schema(executionContext).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;

  const users = [
    {
      id: 'user_001',
      email: 'admin@example.com',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: 'user_002',
      email: 'member@example.com',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
      kind: 'user' as const,
    },
  ];

  for (const user of users) {
    const plan = sql({ context: executionContext })
      .insert(userTable, {
        id: param('id'),
        email: param('email'),
        createdAt: param('createdAt'),
        kind: param('kind'),
      })
      .build({ params: user });

    for await (const _row of runtime.execute(plan)) {
      // consume iterator
    }
  }

  const posts = [
    {
      id: 'post_001',
      title: 'Older post',
      userId: 'user_001',
      createdAt: new Date('2024-01-01T10:00:00.000Z'),
    },
    {
      id: 'post_002',
      title: 'Newer post',
      userId: 'user_001',
      createdAt: new Date('2024-01-02T10:00:00.000Z'),
    },
    {
      id: 'post_003',
      title: 'Other user post',
      userId: 'user_002',
      createdAt: new Date('2024-01-03T10:00:00.000Z'),
    },
  ];

  for (const post of posts) {
    const plan = sql({ context: executionContext })
      .insert(postTable, {
        id: param('id'),
        title: param('title'),
        userId: param('userId'),
        createdAt: param('createdAt'),
      })
      .build({ params: post });

    for await (const _row of runtime.execute(plan)) {
      // consume iterator
    }
  }
}

describe('Repository integration examples', () => {
  it(
    'repositoryGetUsers returns limited rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedRepositoryData(runtime);
          const users = await repositoryGetUsers(1, runtime);

          expect(users).toHaveLength(1);
          expect(users[0]).toMatchObject({
            id: expect.any(String),
            email: expect.any(String),
            kind: expect.any(String),
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'repositoryGetAdminUsers returns only admin rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedRepositoryData(runtime);
          const users = await repositoryGetAdminUsers(10, runtime);

          expect(users).toHaveLength(1);
          expect(users[0]).toMatchObject({
            id: 'user_001',
            email: 'admin@example.com',
            kind: 'admin',
          });
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'repositoryGetUserPosts returns scoped posts in descending createdAt order',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedRepositoryData(runtime);
          const posts = await repositoryGetUserPosts('user_001', 10, runtime);
          const postRecords = posts as Array<Record<string, unknown>>;

          expect(postRecords.map((post) => post['id'])).toEqual(['post_002', 'post_001']);
          expect(postRecords.every((post) => post['userId'] === 'user_001')).toBe(true);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
