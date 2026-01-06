import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { type createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { createDevDatabase, type DevDatabase, timeouts } from '@prisma-next/test-utils';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contract as noEmitContract } from '../prisma/contract';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import {
  closeRuntime as closeNoEmitRuntime,
  getRuntime as getNoEmitRuntime,
} from '../src/prisma/runtime-no-emit';
import { getUserById as getUserByIdNoEmit } from '../src/queries/get-user-by-id-no-emit';
import { getUsers as getUsersNoEmit } from '../src/queries/get-users-no-emit';
import { ormGetUserById } from '../src/queries/orm-get-user-by-id';
import { ormGetUsers } from '../src/queries/orm-get-users';
import { ormGetUsersWithPosts as ormGetUsersWithPostsInclude } from '../src/queries/orm-includes';
import { ormGetUsersBackward, ormGetUsersByIdCursor } from '../src/queries/orm-pagination';
import { ormGetUsersWithPosts as ormGetUsersWithPostsRelation } from '../src/queries/orm-relation-filters';
import { ormCreateUser, ormDeleteUser, ormUpdateUser } from '../src/queries/orm-writes';
import { closeTestRuntime, createTestRuntime, initTestDatabase } from './utils/control-client';
import {
  pgvectorExtensionRuntimeDescriptor,
  postgresAdapterRuntimeDescriptor,
  postgresTargetRuntimeDescriptor,
} from './utils/framework-components';

// Use the emitted JSON contract which has the real computed hashes
const contract = validateContract<Contract>(contractJson);

/**
 * Creates a runtime context for the given contract.
 */
function createContext<TContract extends SqlContract<SqlStorage>>(contract: TContract) {
  return createRuntimeContext({
    contract,
    target: postgresTargetRuntimeDescriptor,
    adapter: postgresAdapterRuntimeDescriptor,
    extensionPacks: [pgvectorExtensionRuntimeDescriptor],
  });
}

/**
 * Seeds test data using the runtime and query DSL.
 */
async function seedTestData(
  runtime: ReturnType<typeof createRuntime>,
  data: { users?: string[]; posts?: Array<{ title: string; userIndex: number }> },
): Promise<{ userIds: number[] }> {
  const context = createContext(contract);
  const tables = schema(context).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;

  const userIds: number[] = [];

  // Insert users (provide all required columns since contract doesn't have defaults)
  if (data.users) {
    for (let i = 0; i < data.users.length; i++) {
      const email = data.users[i]!;
      const id = i + 1;
      const createdAt = new Date();

      const plan = sql({ context })
        .insert(userTable, {
          id: param('id'),
          email: param('email'),
          createdAt: param('createdAt'),
        })
        .returning(userTable.columns['id']!)
        .build({ params: { id, email, createdAt } });

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

      const plan = sql({ context })
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
  let devDb: DevDatabase;
  let runtime: ReturnType<typeof createRuntime>;
  let pool: Pool;

  beforeEach(async () => {
    devDb = await createDevDatabase();
    await initTestDatabase({ connection: devDb.connectionString, contractIR: contract });
    const testRuntime = createTestRuntime(devDb.connectionString, contract);
    runtime = testRuntime.runtime;
    pool = testRuntime.pool;
    // Set DATABASE_URL for query modules that use the global runtime
    process.env['DATABASE_URL'] = devDb.connectionString;
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await closeTestRuntime({ runtime, pool });
    await devDb.close();
  });

  it('getUsers returns users with selected fields, respects limit and ordering', async () => {
    await seedTestData(runtime, {
      users: ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
    });

    const users = await ormGetUsers(2, runtime);

    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      id: expect.any(Number),
      email: expect.any(String),
      createdAt: expect.anything(),
    });
    expect(users[0]).not.toMatchObject({ posts: expect.anything() });
  });

  it('getUserById returns single user by ID', async () => {
    await seedTestData(runtime, { users: ['alice@example.com'] });

    const user = await ormGetUserById(1, runtime);

    expect(user).not.toBeNull();
    expect(user).toMatchObject({
      id: 1,
      email: 'alice@example.com',
      createdAt: expect.anything(),
    });
  });

  it('relation filters: where.related.posts.some() returns users with at least one post', async () => {
    await seedTestData(runtime, {
      users: ['alice@example.com', 'bob@example.com'],
      posts: [{ title: 'First Post', userIndex: 0 }],
    });

    const users = await ormGetUsersWithPostsRelation(runtime);

    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toMatchObject({
      id: expect.anything(),
      email: expect.anything(),
    });
  });

  it('includes: include.posts() returns users with nested posts arrays', async () => {
    await seedTestData(runtime, {
      users: ['alice@example.com', 'bob@example.com'],
      posts: [
        { title: 'First Post', userIndex: 0 },
        { title: 'Second Post', userIndex: 0 },
        { title: 'Third Post', userIndex: 1 },
      ],
    });

    const users = await ormGetUsersWithPostsInclude(10, runtime);

    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toMatchObject({
      id: expect.anything(),
      email: expect.anything(),
      posts: expect.any(Array),
    });
  });

  it('writes: create() inserts a user', async () => {
    const affectedRows = await ormCreateUser(
      { id: 1, email: 'alice@example.com', createdAt: new Date() },
      runtime,
    );

    expect(affectedRows).toBe(1);
  });

  it('writes: update() updates a user', async () => {
    await seedTestData(runtime, { users: ['alice@example.com'] });

    const affectedRows = await ormUpdateUser(1, 'alice-updated@example.com', runtime);

    expect(affectedRows).toBe(1);
  });

  it('writes: delete() deletes a user', async () => {
    await seedTestData(runtime, { users: ['alice@example.com'] });

    const affectedRows = await ormDeleteUser(1, runtime);

    expect(affectedRows).toBe(1);
  });

  it('pagination: ormGetUsersByIdCursor returns paginated users with gt cursor', async () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i + 1}@example.com`);
    await seedTestData(runtime, { users: emails });

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
  });

  it('pagination: ormGetUsersBackward returns users before cursor with lt operator', async () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i + 1}@example.com`);
    await seedTestData(runtime, { users: emails });

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
  });
});

describe('No-emit mode integration tests (TypeScript contract)', () => {
  let devDb: DevDatabase;

  beforeEach(async () => {
    devDb = await createDevDatabase();
    // Initialize with the TypeScript-built contract (no-emit mode)
    await initTestDatabase({ connection: devDb.connectionString, contractIR: noEmitContract });
    // Set DATABASE_URL for no-emit runtime
    process.env['DATABASE_URL'] = devDb.connectionString;
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await closeNoEmitRuntime();
    await devDb.close();
  });

  /**
   * Seeds test data using the no-emit runtime.
   */
  async function seedNoEmitTestData(data: { users?: string[] }): Promise<{ userIds: number[] }> {
    const runtime = getNoEmitRuntime();
    const context = createContext(noEmitContract);
    const tables = schema(context).tables;
    const userTable = tables['user']!;

    const userIds: number[] = [];

    if (data.users) {
      for (let i = 0; i < data.users.length; i++) {
        const email = data.users[i]!;
        const id = i + 1;
        const createdAt = new Date();

        const plan = sql({ context })
          .insert(userTable, {
            id: param('id'),
            email: param('email'),
            createdAt: param('createdAt'),
          })
          .returning(userTable.columns['id']!)
          .build({ params: { id, email, createdAt } });

        for await (const row of runtime.execute(plan)) {
          userIds.push((row as { id: number }).id);
        }
      }
    }

    return { userIds };
  }

  it(
    'getUsers returns users with selected fields',
    async () => {
      await seedNoEmitTestData({
        users: ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
      });

      const users = await getUsersNoEmit(2);

      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({
        id: expect.any(Number),
        email: expect.any(String),
        createdAt: expect.anything(),
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'getUserById returns single user by ID',
    async () => {
      await seedNoEmitTestData({ users: ['alice@example.com'] });

      const user = await getUserByIdNoEmit(1);

      expect(user).not.toBeNull();
      expect(user).toMatchObject({
        id: 1,
        email: 'alice@example.com',
        createdAt: expect.anything(),
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'getUserById returns null for non-existent user',
    async () => {
      await seedNoEmitTestData({ users: ['alice@example.com'] });

      const user = await getUserByIdNoEmit(999);

      expect(user).toBeNull();
    },
    timeouts.spinUpPpgDev,
  );
});
