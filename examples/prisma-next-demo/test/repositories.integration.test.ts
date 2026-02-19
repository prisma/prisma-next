import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { budgets, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ormClientGetAdminUsers } from '../src/orm-client/get-admin-users';
import { ormClientGetUserPosts } from '../src/orm-client/get-user-posts';
import { ormClientGetUsers } from '../src/orm-client/get-users';
import { db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;
const executionStack = db.stack;
const executionStackInstance = instantiateExecutionStack(executionStack);

function createTestDriver(connectionString: string) {
  const driverDescriptor = executionStack.driver;
  if (!driverDescriptor) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const pool = new Pool({ connectionString });
  return driverDescriptor.create({ connect: { pool }, cursor: { disabled: true } });
}

function getRuntime(connectionString: string): Runtime {
  return createRuntime({
    stackInstance: executionStackInstance,
    context,
    driver: createTestDriver(connectionString),
    verify: { mode: 'onFirstUse', requireMarker: false },
    plugins: [
      budgets({
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { user: 10_000, post: 10_000 },
        maxLatencyMs: 1_000,
      }),
    ],
  });
}

async function seedOrmClientData(runtime: Runtime): Promise<void> {
  const tables = schema(context).tables;
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
    const plan = sql({ context })
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
    const plan = sql({ context })
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

describe('ORM client integration examples', () => {
  it(
    'ormClientGetUsers returns limited rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetUsers(1, runtime);

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
    'ormClientGetAdminUsers returns only admin rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetAdminUsers(10, runtime);

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
    'ormClientGetUserPosts returns scoped posts in descending createdAt order',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetUserPosts('user_001', 10, runtime);
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
