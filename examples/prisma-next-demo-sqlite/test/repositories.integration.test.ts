import { sql } from '@prisma-next/sql-builder/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { describe, expect, it } from 'vitest';
import { ormClientAggregateUsers } from '../src/orm-client/aggregate-users';
import { ormClientCreateUser } from '../src/orm-client/create-user';
import { ormClientCreateUserWithAddress } from '../src/orm-client/create-user-with-address';
import { ormClientDeleteUser } from '../src/orm-client/delete-user';
import { ormClientFindUserByEmail } from '../src/orm-client/find-user-by-email';
import { ormClientFindUserById } from '../src/orm-client/find-user-by-id';
import { ormClientGetAdminUsers } from '../src/orm-client/get-admin-users';
import { ormClientGetDashboardUsers } from '../src/orm-client/get-dashboard-users';
import { ormClientGetPostFeed } from '../src/orm-client/get-post-feed';
import { ormClientGetUserInsights } from '../src/orm-client/get-user-insights';
import { ormClientGetUserKindBreakdown } from '../src/orm-client/get-user-kind-breakdown';
import { ormClientGetUserPosts } from '../src/orm-client/get-user-posts';
import { ormClientGetUsers } from '../src/orm-client/get-users';
import { ormClientGetUsersBackwardCursor } from '../src/orm-client/get-users-backward-cursor';
import { ormClientGetUsersByIdCursor } from '../src/orm-client/get-users-by-id-cursor';
import { ormClientUpdateUserEmail } from '../src/orm-client/update-user-email';
import { ormClientUpsertUser } from '../src/orm-client/upsert-user';
import { db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';
import { createTempDatabase, getRuntime } from './utils/sqlite-runtime';

const context = db.context;
const { contract } = context;

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
  const builder = sql({ context });

  const users = [
    {
      id: seededUserIds.admin,
      email: 'admin@example.com',
      displayName: 'Admin',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      kind: 'admin',
    },
    {
      id: seededUserIds.member,
      email: 'member@example.com',
      displayName: 'Member',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
      kind: 'user',
    },
    {
      id: seededUserIds.adminTwo,
      email: 'admin2@example.org',
      displayName: 'Admin Two',
      createdAt: new Date('2024-01-03T00:00:00.000Z'),
      kind: 'admin',
    },
    {
      id: seededUserIds.reader,
      email: 'reader@example.com',
      displayName: 'Reader',
      createdAt: new Date('2024-01-04T00:00:00.000Z'),
      kind: 'user',
    },
  ];

  for (const user of users) {
    await runtime.execute(builder.user.insert(user).build());
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
    await runtime.execute(builder.post.insert(post).build());
  }
}

async function withTestRuntime(body: (runtime: Runtime) => Promise<void>): Promise<void> {
  const tempDb = createTempDatabase();
  try {
    await initTestDatabase({ connection: tempDb.databasePath, contract });
    const runtime = await getRuntime(tempDb.databasePath);
    try {
      await body(runtime);
    } finally {
      await runtime.close();
    }
  } finally {
    tempDb.cleanup();
  }
}

describe('ORM client integration examples (SQLite)', () => {
  it('ormClientGetUsers returns limited rows', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const users = await ormClientGetUsers(1, runtime);

      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
        kind: expect.any(String),
      });
    });
  });

  it('ormClientGetAdminUsers returns only admin rows', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const users = await ormClientGetAdminUsers(10, runtime);

      expect(users).toHaveLength(2);
      expect(users.every((user) => user.kind === 'admin')).toBe(true);
      expect(users.map((user) => user.id).sort()).toEqual([
        seededUserIds.admin,
        seededUserIds.adminTwo,
      ]);
    });
  });

  it('ormClientFindUserByEmail returns a matching user and null for unknown email', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const user = await ormClientFindUserByEmail('member@example.com', runtime);
      const missing = await ormClientFindUserByEmail('missing@example.com', runtime);

      expect(user).toMatchObject({
        email: 'member@example.com',
        kind: 'user',
      });
      expect(user!.id).toBe(seededUserIds.member);
      expect(missing).toBeNull();
    });
  });

  it('ormClientFindUserById uses shorthand first({ id })', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const user = await ormClientFindUserById(seededUserIds.admin, runtime);
      const missing = await ormClientFindUserById('00000000-0000-0000-0000-000000000099', runtime);

      expect(user!.id).toBe(seededUserIds.admin);
      expect(missing).toBeNull();
    });
  });

  it('ormClientCreateUser and ormClientUpdateUserEmail run create()/update() terminal methods', async () => {
    await withTestRuntime(async (runtime) => {
      const created = await ormClientCreateUser(
        {
          id: '00000000-0000-0000-0000-000000000099',
          email: 'created@example.com',
          displayName: 'Created User',
          kind: 'user',
          createdAt: new Date('2024-02-01T00:00:00.000Z'),
        },
        runtime,
      );
      const updated = await ormClientUpdateUserEmail(
        '00000000-0000-0000-0000-000000000099',
        'updated@example.com',
        runtime,
      );

      expect(created).toEqual({
        id: '00000000-0000-0000-0000-000000000099',
        email: 'created@example.com',
        kind: 'user',
      });
      expect(updated).toEqual({
        id: '00000000-0000-0000-0000-000000000099',
        email: 'updated@example.com',
        kind: 'user',
      });
    });
  });

  it('ormClientCreateUserWithAddress creates a user with an embedded Address value object', async () => {
    await withTestRuntime(async (runtime) => {
      const address = {
        street: '789 Elm Blvd',
        city: 'Austin',
        zip: '73301',
        country: 'US',
      };
      const created = await ormClientCreateUserWithAddress(
        {
          id: '00000000-0000-0000-0000-000000000088',
          email: 'addressed@example.com',
          displayName: 'Addressed User',
          kind: 'user',
          createdAt: new Date('2024-02-01T00:00:00.000Z'),
          address,
        },
        runtime,
      );

      expect(created).toMatchObject({
        id: '00000000-0000-0000-0000-000000000088',
        email: 'addressed@example.com',
        kind: 'user',
        address,
      });

      const fetched = await ormClientGetUsers(10, runtime);
      const found = fetched.find((u) => u.id === '00000000-0000-0000-0000-000000000088');
      expect(found?.address).toEqual(address);
    });
  });

  it('ormClientAggregateUsers computes aggregate() totals', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const aggregates = await ormClientAggregateUsers(runtime);

      expect(aggregates).toEqual({
        totalUsers: 4,
        adminUsers: 2,
      });
    });
  });

  it('ormClientGetUserPosts returns scoped posts in descending createdAt order', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const posts = await ormClientGetUserPosts(seededUserIds.admin, 10, runtime);

      expect(posts.map((post) => post.id)).toEqual([seededPostIds.newer, seededPostIds.older]);
      expect(posts.every((post) => post.userId === seededUserIds.admin)).toBe(true);
    });
  });

  it('ormClientGetDashboardUsers composes compound filters with select and include', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const users = await ormClientGetDashboardUsers('example.com', 'post', 10, 1, runtime);

      expect(users.map((user) => user.id)).toEqual([seededUserIds.adminTwo, seededUserIds.admin]);
      expect(users.map((user) => user.kind)).toEqual(['admin', 'admin']);
      expect(users.map((user) => user.posts.map((post) => post.id))).toEqual([
        [seededPostIds.adminZebra],
        [seededPostIds.newer],
      ]);
    });
  });

  it('ormClientGetPostFeed returns posts with projected to-one include payloads', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const posts = await ormClientGetPostFeed('post', 3, runtime);

      expect(posts.map((post) => post.id)).toEqual([
        seededPostIds.adminZebra,
        seededPostIds.adminDeepDive,
        seededPostIds.newer,
      ]);
      expect(posts.map((post) => post.user.id)).toEqual([
        seededUserIds.adminTwo,
        seededUserIds.adminTwo,
        seededUserIds.admin,
      ]);
    });
  });

  it('ormClientGetUsersByIdCursor returns rows after cursor boundary', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const firstPage = await ormClientGetUsersByIdCursor(null, 2, runtime);
      const secondPage = await ormClientGetUsersByIdCursor(seededUserIds.member, 2, runtime);

      expect(firstPage.map((user) => user.id)).toEqual([seededUserIds.admin, seededUserIds.member]);
      expect(secondPage.map((user) => user.id)).toEqual([
        seededUserIds.adminTwo,
        seededUserIds.reader,
      ]);
    });
  });

  it('ormClientGetUserInsights returns per-user counts with latest related post', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const users = await ormClientGetUserInsights(4, runtime);

      expect(users.map((user) => user.id)).toEqual([
        seededUserIds.reader,
        seededUserIds.adminTwo,
        seededUserIds.member,
        seededUserIds.admin,
      ]);

      expect(users.map((user) => user.posts.totalPosts)).toEqual([0, 2, 1, 2]);
      expect(users.map((user) => user.posts.latestPost.map((post) => post.id))).toEqual([
        [],
        [seededPostIds.adminZebra],
        [seededPostIds.memberNote],
        [seededPostIds.newer],
      ]);
    });
  });

  it('ormClientGetUserKindBreakdown returns grouped user counts with having filter', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const atLeastTwo = await ormClientGetUserKindBreakdown(2, runtime);
      const atLeastThree = await ormClientGetUserKindBreakdown(3, runtime);

      expect(atLeastTwo).toEqual([
        { kind: 'admin', totalUsers: 2 },
        { kind: 'user', totalUsers: 2 },
      ]);
      expect(atLeastThree).toEqual([]);
    });
  });

  it('ormClientUpsertUser updates existing row and inserts missing row', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const insertedId = '00000000-0000-0000-0000-000000000099';

      const updated = await ormClientUpsertUser(
        {
          id: seededUserIds.admin,
          email: 'admin-upserted@example.com',
          displayName: 'Admin Upserted',
          kind: 'admin',
        },
        runtime,
      );
      const inserted = await ormClientUpsertUser(
        {
          id: insertedId,
          email: 'inserted-upsert@example.com',
          displayName: 'Inserted Upsert',
          kind: 'user',
          createdAt: new Date('2024-02-01T00:00:00.000Z'),
        },
        runtime,
      );

      expect(updated).toMatchObject({
        id: seededUserIds.admin,
        email: 'admin-upserted@example.com',
        kind: 'admin',
      });
      expect(inserted).toMatchObject({
        id: insertedId,
        email: 'inserted-upsert@example.com',
        kind: 'user',
      });
      expect(inserted.createdAt).toBeTruthy();

      const insertedUser = await ormClientFindUserById(insertedId, runtime);
      expect(insertedUser).toMatchObject({
        id: insertedId,
        email: 'inserted-upsert@example.com',
        kind: 'user',
      });
    });
  });

  it('ormClientDeleteUser removes a user by id', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);
      const before = await ormClientFindUserById(seededUserIds.reader, runtime);
      expect(before).not.toBeNull();

      await ormClientDeleteUser(seededUserIds.reader, runtime);

      const after = await ormClientFindUserById(seededUserIds.reader, runtime);
      expect(after).toBeNull();
    });
  });

  it('ormClientGetUsersBackwardCursor returns rows before cursor in descending id order', async () => {
    await withTestRuntime(async (runtime) => {
      await seedOrmClientData(runtime);

      const page = await ormClientGetUsersBackwardCursor(seededUserIds.reader, 2, runtime);
      expect(page.map((user) => user.id)).toEqual([seededUserIds.adminTwo, seededUserIds.member]);

      const partialPage = await ormClientGetUsersBackwardCursor(seededUserIds.member, 10, runtime);
      expect(partialPage.map((user) => user.id)).toEqual([seededUserIds.admin]);

      const emptyPage = await ormClientGetUsersBackwardCursor(seededUserIds.admin, 2, runtime);
      expect(emptyPage).toHaveLength(0);
    });
  });
});
