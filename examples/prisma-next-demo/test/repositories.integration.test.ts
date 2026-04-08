import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { type CreateRuntimeOptions, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ormClientAggregateUsers } from '../src/orm-client/aggregate-users';
import { ormClientCreateUser } from '../src/orm-client/create-user';
import { ormClientCreateUserWithAddress } from '../src/orm-client/create-user-with-address';
import { ormClientDeleteUser } from '../src/orm-client/delete-user';
import { ormClientFindSimilarPosts } from '../src/orm-client/find-similar-posts';
import { ormClientFindUserByEmail } from '../src/orm-client/find-user-by-email';
import { ormClientFindUserById } from '../src/orm-client/find-user-by-id';
import { ormClientGetAdminUsers } from '../src/orm-client/get-admin-users';
import { ormClientGetDashboardUsers } from '../src/orm-client/get-dashboard-users';
import { ormClientGetLatestUserPerKind } from '../src/orm-client/get-latest-user-per-kind';
import { ormClientGetPostFeed } from '../src/orm-client/get-post-feed';
import { ormClientGetUserInsights } from '../src/orm-client/get-user-insights';
import { ormClientGetUserKindBreakdown } from '../src/orm-client/get-user-kind-breakdown';
import { ormClientGetUserPosts } from '../src/orm-client/get-user-posts';
import { ormClientGetUsers } from '../src/orm-client/get-users';
import { ormClientGetUsersBackwardCursor } from '../src/orm-client/get-users-backward-cursor';
import { ormClientGetUsersByIdCursor } from '../src/orm-client/get-users-by-id-cursor';
import { ormClientSearchPostsByEmbedding } from '../src/orm-client/search-posts-by-embedding';
import { ormClientUpdateUserEmail } from '../src/orm-client/update-user-email';
import { ormClientUpsertUser } from '../src/orm-client/upsert-user';
import { db } from '../src/prisma/db';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;
const executionStack = db.stack;

async function createTestDriver(connectionString: string) {
  const stackInstance = instantiateExecutionStack(
    executionStack,
  ) as CreateRuntimeOptions['stackInstance'];
  const driver = stackInstance.driver as unknown as SqlDriver<unknown>;
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

const embeddingPostIds = {
  reference: '20000000-0000-0000-0000-000000000001',
  similar1: '20000000-0000-0000-0000-000000000002',
  similar2: '20000000-0000-0000-0000-000000000003',
  dissimilar: '20000000-0000-0000-0000-000000000004',
} as const;

function makeVector(leadingValues: number[]): number[] {
  const vec = new Array<number>(1536).fill(0);
  for (let i = 0; i < leadingValues.length; i++) {
    vec[i] = leadingValues[i]!;
  }
  return vec;
}

async function seedOrmClientData(runtime: Runtime): Promise<void> {
  const db = sql({ context });

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
    await runtime.execute(db.user.insert(user).build());
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
    await runtime.execute(db.post.insert(post).build());
  }
}

async function seedEmbeddingPosts(runtime: Runtime): Promise<void> {
  const db = sql({ context });
  const posts = [
    {
      id: embeddingPostIds.reference,
      title: 'Reference post',
      userId: seededUserIds.admin,
      createdAt: new Date('2024-02-01T10:00:00.000Z'),
      embedding: makeVector([1, 0, 0]),
    },
    {
      id: embeddingPostIds.similar1,
      title: 'Very similar post',
      userId: seededUserIds.member,
      createdAt: new Date('2024-02-02T10:00:00.000Z'),
      embedding: makeVector([0.95, 0.05, 0]),
    },
    {
      id: embeddingPostIds.similar2,
      title: 'Somewhat similar post',
      userId: seededUserIds.adminTwo,
      createdAt: new Date('2024-02-03T10:00:00.000Z'),
      embedding: makeVector([0.7, 0.3, 0]),
    },
    {
      id: embeddingPostIds.dissimilar,
      title: 'Dissimilar post',
      userId: seededUserIds.admin,
      createdAt: new Date('2024-02-04T10:00:00.000Z'),
      embedding: makeVector([-0.5, -0.5, 0]),
    },
  ];

  for (const post of posts) {
    await runtime.execute(db.post.insert(post).build());
  }
}

describe('ORM client integration examples', () => {
  it(
    'ormClientGetUsers returns limited rows',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetAdminUsers(10, runtime);

          expect(users).toHaveLength(2);
          expect(users.every((user) => user.kind === 'admin')).toBe(true);
          expect(users.map((user) => user.id).sort()).toEqual([
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const user = await ormClientFindUserByEmail('member@example.com', runtime);
          const missing = await ormClientFindUserByEmail('missing@example.com', runtime);

          expect(user).toMatchObject({
            email: 'member@example.com',
            kind: 'user',
          });
          expect(user!.id).toBe(seededUserIds.member);
          expect(missing).toBeNull();
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindUserById uses shorthand first({ id })',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const user = await ormClientFindUserById(seededUserIds.admin, runtime);
          const missing = await ormClientFindUserById(
            '00000000-0000-0000-0000-000000000099',
            runtime,
          );

          expect(user!.id).toBe(seededUserIds.admin);
          expect(missing).toBeNull();
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientCreateUser and ormClientUpdateUserEmail run create()/update() terminal methods',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          const created = await ormClientCreateUser(
            {
              id: '00000000-0000-0000-0000-000000000099',
              email: 'created@example.com',
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
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientCreateUserWithAddress creates a user with an embedded Address value object',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
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
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientAggregateUsers computes aggregate() totals',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const aggregates = await ormClientAggregateUsers(runtime);

          expect(aggregates).toEqual({
            totalUsers: 4,
            adminUsers: 2,
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetUserPosts(seededUserIds.admin, 10, runtime);

          expect(posts.map((post) => post.id)).toEqual([seededPostIds.newer, seededPostIds.older]);
          expect(posts.every((post) => post.userId === seededUserIds.admin)).toBe(true);
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetDashboardUsers('example.com', 'post', 10, 1, runtime);

          expect(users.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.admin,
          ]);
          expect(users.map((user) => user.kind)).toEqual(['admin', 'admin']);
          expect(users.map((user) => user.posts.map((post) => post.id))).toEqual([
            [seededPostIds.adminZebra],
            [seededPostIds.newer],
          ]);
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const posts = await ormClientGetPostFeed('post', 3, runtime);

          expect(posts.map((post) => post.id)).toEqual([
            seededPostIds.adminZebra,
            seededPostIds.adminDeepDive,
            seededPostIds.newer,
          ]);
          expect(posts.every((post) => 'embedding' in post === false)).toBe(true);
          expect(posts.map((post) => post.user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.adminTwo,
            seededUserIds.admin,
          ]);
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const firstPage = await ormClientGetUsersByIdCursor(null, 2, runtime);
          const secondPage = await ormClientGetUsersByIdCursor(seededUserIds.member, 2, runtime);

          expect(firstPage.map((user) => user.id)).toEqual([
            seededUserIds.admin,
            seededUserIds.member,
          ]);
          expect(secondPage.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.reader,
          ]);
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
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const users = await ormClientGetLatestUserPerKind(runtime);

          expect(users).toHaveLength(2);
          expect(users.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.reader,
          ]);
          expect(users.map((user) => user.kind)).toEqual(['admin', 'user']);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserInsights returns per-user counts with latest related post',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
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
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUserKindBreakdown returns grouped user counts with having filter',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const atLeastTwo = await ormClientGetUserKindBreakdown(2, runtime);
          const atLeastThree = await ormClientGetUserKindBreakdown(3, runtime);

          expect(atLeastTwo).toEqual([
            { kind: 'admin', totalUsers: 2 },
            { kind: 'user', totalUsers: 2 },
          ]);
          expect(atLeastThree).toEqual([]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientUpsertUser updates existing row and inserts missing row',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const insertedId = '00000000-0000-0000-0000-000000000099';

          const updated = await ormClientUpsertUser(
            {
              id: seededUserIds.admin,
              email: 'admin-upserted@example.com',
              kind: 'admin',
            },
            runtime,
          );
          const inserted = await ormClientUpsertUser(
            {
              id: insertedId,
              email: 'inserted-upsert@example.com',
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
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientDeleteUser removes a user by id',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          const before = await ormClientFindUserById(seededUserIds.reader, runtime);
          expect(before).not.toBeNull();

          await ormClientDeleteUser(seededUserIds.reader, runtime);

          const after = await ormClientFindUserById(seededUserIds.reader, runtime);
          expect(after).toBeNull();
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientGetUsersBackwardCursor returns rows before cursor in descending id order',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);

          const page = await ormClientGetUsersBackwardCursor(seededUserIds.reader, 2, runtime);
          expect(page.map((user) => user.id)).toEqual([
            seededUserIds.adminTwo,
            seededUserIds.member,
          ]);

          const partialPage = await ormClientGetUsersBackwardCursor(
            seededUserIds.member,
            10,
            runtime,
          );
          expect(partialPage.map((user) => user.id)).toEqual([seededUserIds.admin]);

          const emptyPage = await ormClientGetUsersBackwardCursor(seededUserIds.admin, 2, runtime);
          expect(emptyPage).toHaveLength(0);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientFindSimilarPosts returns posts ordered by cosine distance with user include',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          await seedEmbeddingPosts(runtime);
          const results = await ormClientFindSimilarPosts(embeddingPostIds.reference, 10, runtime);

          expect(results.map((r) => r.id)).toEqual([
            embeddingPostIds.similar1,
            embeddingPostIds.similar2,
          ]);
          expect(results.map((r) => r.user.email)).toEqual([
            'member@example.com',
            'admin2@example.org',
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ormClientSearchPostsByEmbedding returns posts within max cosine distance ordered by similarity',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedOrmClientData(runtime);
          await seedEmbeddingPosts(runtime);
          const results = await ormClientSearchPostsByEmbedding(
            makeVector([1, 0, 0]),
            0.5,
            10,
            runtime,
          );

          expect(results.map((r) => r.id)).toEqual([
            embeddingPostIds.reference,
            embeddingPostIds.similar1,
            embeddingPostIds.similar2,
          ]);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
