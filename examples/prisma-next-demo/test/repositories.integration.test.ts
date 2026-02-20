import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ormClientFindUserByEmail } from '../src/orm-client/find-user-by-email';
import { ormClientGetAdminUsers } from '../src/orm-client/get-admin-users';
import { ormClientGetDashboardUsers } from '../src/orm-client/get-dashboard-users';
import { ormClientGetLatestUserPerKind } from '../src/orm-client/get-latest-user-per-kind';
import { ormClientGetPostFeed } from '../src/orm-client/get-post-feed';
import { ormClientGetUserPosts } from '../src/orm-client/get-user-posts';
import { ormClientGetUsers } from '../src/orm-client/get-users';
import { ormClientGetUsersByIdCursor } from '../src/orm-client/get-users-by-id-cursor';
import { db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;
const executionStack = db.stack;

async function createTestDriver(connectionString: string) {
  const stackInstance = instantiateExecutionStack(executionStack);
  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const pool = new Pool({ connectionString });
  try {
    await driver.connect({ kind: 'pgPool', pool });
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { stackInstance, driver };
}

async function getRuntime(connectionString: string): Promise<Runtime> {
  const { stackInstance, driver } = await createTestDriver(connectionString);
  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
}

const seededUserIds = {
  admin: '00000000-0000-0000-0000-000000000001',
  member: '00000000-0000-0000-0000-000000000002',
  adminTwo: '00000000-0000-0000-0000-000000000003',
  reader: '00000000-0000-0000-0000-000000000004',
} as const;

const seededPostIds = {
  older: '10000000-0000-0000-0000-000000000001',
  newer: '10000000-0000-0000-0000-000000000002',
  memberNote: '10000000-0000-0000-0000-000000000003',
  adminDeepDive: '10000000-0000-0000-0000-000000000004',
  adminZebra: '10000000-0000-0000-0000-000000000005',
} as const;

async function seedOrmClientData(runtime: Runtime): Promise<void> {
  const tables = schema(context).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;

  const users = [
    {
      id: seededUserIds.admin,
      email: 'admin@example.com',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: seededUserIds.member,
      email: 'member@example.com',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
      kind: 'user' as const,
    },
    {
      id: seededUserIds.adminTwo,
      email: 'admin2@example.org',
      createdAt: new Date('2024-01-03T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: seededUserIds.reader,
      email: 'reader@example.com',
      createdAt: new Date('2024-01-04T00:00:00.000Z'),
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
      id: seededPostIds.older,
      title: 'Older post',
      userId: seededUserIds.admin,
      createdAt: new Date('2024-01-01T10:00:00.000Z'),
    },
    {
      id: seededPostIds.newer,
      title: 'Newer post',
      userId: seededUserIds.admin,
      createdAt: new Date('2024-01-02T10:00:00.000Z'),
    },
    {
      id: seededPostIds.memberNote,
      title: 'Other user note',
      userId: seededUserIds.member,
      createdAt: new Date('2024-01-03T10:00:00.000Z'),
    },
    {
      id: seededPostIds.adminDeepDive,
      title: 'Admin deep dive post',
      userId: seededUserIds.adminTwo,
      createdAt: new Date('2024-01-04T10:00:00.000Z'),
    },
    {
      id: seededPostIds.adminZebra,
      title: 'Zebra post note',
      userId: seededUserIds.adminTwo,
      createdAt: new Date('2024-01-05T10:00:00.000Z'),
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

function asId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value);
}

describe('ORM client integration examples', () => {
  it(
    'ormClientGetUsers returns limited rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

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
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetAdminUsers(10, runtime);

          const userRecords = users as Array<Record<string, unknown>>;
          expect(userRecords).toHaveLength(2);
          expect(userRecords.every((user) => user['kind'] === 'admin')).toBe(true);
          expect(userRecords.map((user) => asId(user['id'])).sort()).toEqual([
            seededUserIds.admin,
            seededUserIds.adminTwo,
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindUserByEmail returns a matching user and null for unknown email',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const user = await ormClientFindUserByEmail('member@example.com', runtime);
          const missing = await ormClientFindUserByEmail('missing@example.com', runtime);

          expect(user).toMatchObject({
            email: 'member@example.com',
            kind: 'user',
          });
          expect(asId((user as Record<string, unknown>)['id'])).toBe(seededUserIds.member);
          expect(missing).toBeNull();
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
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetUserPosts(seededUserIds.admin, 10, runtime);
          const postRecords = posts as Array<Record<string, unknown>>;

          expect(postRecords.map((post) => asId(post['id']))).toEqual([
            seededPostIds.newer,
            seededPostIds.older,
          ]);
          expect(postRecords.every((post) => asId(post['userId']) === seededUserIds.admin)).toBe(
            true,
          );
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetDashboardUsers composes compound filters with select and include',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetDashboardUsers('example.com', 'post', 10, 1, runtime);
          const records = users as Array<Record<string, unknown>>;

          expect(records.map((user) => asId(user['id']))).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.admin,
          ]);
          expect(records.map((user) => user['kind'])).toEqual(['admin', 'admin']);
          expect(
            records.map((user) =>
              (user['posts'] as Array<Record<string, unknown>>).map((post) => asId(post['id'])),
            ),
          ).toEqual([[seededPostIds.adminZebra], [seededPostIds.newer]]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetPostFeed returns posts with projected to-one include payloads',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetPostFeed('post', 3, runtime);
          const postRecords = posts as Array<Record<string, unknown>>;

          expect(postRecords.map((post) => asId(post['id']))).toEqual([
            seededPostIds.adminZebra,
            seededPostIds.adminDeepDive,
            seededPostIds.newer,
          ]);
          expect(postRecords.every((post) => 'embedding' in post === false)).toBe(true);
          expect(
            postRecords.map((post) => asId((post['user'] as Record<string, unknown>)['id'])),
          ).toEqual([seededUserIds.adminTwo, seededUserIds.adminTwo, seededUserIds.admin]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUsersByIdCursor returns rows after cursor boundary',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const firstPage = await ormClientGetUsersByIdCursor(null, 2, runtime);
          const secondPage = await ormClientGetUsersByIdCursor(seededUserIds.member, 2, runtime);

          expect(
            (firstPage as Array<Record<string, unknown>>).map((user) => asId(user['id'])),
          ).toEqual([seededUserIds.admin, seededUserIds.member]);
          expect(
            (secondPage as Array<Record<string, unknown>>).map((user) => asId(user['id'])),
          ).toEqual([seededUserIds.adminTwo, seededUserIds.reader]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetLatestUserPerKind returns one latest row per kind using distinctOn',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR: contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetLatestUserPerKind(runtime);
          const records = users as Array<Record<string, unknown>>;

          expect(records).toHaveLength(2);
          expect(records.map((user) => asId(user['id']))).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.reader,
          ]);
          expect(records.map((user) => user['kind'])).toEqual(['admin', 'user']);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
