import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { withReturningCapability } from './collection-fixtures';
import { createTestContract } from './helpers';
import {
  createPgIntegrationRuntime,
  type PgIntegrationRuntime,
  seedPosts,
  seedProfiles,
  seedUsers,
  setupTestSchema,
} from './integration-helpers';

async function withCollectionRuntime(
  fn: (runtime: PgIntegrationRuntime) => Promise<void>,
): Promise<void> {
  await withDevDatabase(async ({ connectionString }) => {
    const runtime = await createPgIntegrationRuntime(connectionString);

    try {
      await setupTestSchema(runtime);
      await fn(runtime);
    } finally {
      await runtime.close();
    }
  });
}

describe('Collection integration (real postgres)', () => {
  it(
    'include() stitches one-to-many and one-to-one relations from real rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = createTestContract();
        const users = new Collection({ contract, runtime }, 'User');

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Primary profile' }]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .include('profile')
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            posts: [
              { id: 10, title: 'Post A', userId: 1, views: 100 },
              { id: 11, title: 'Post B', userId: 1, views: 200 },
            ],
            profile: { id: 100, userId: 1, bio: 'Primary profile' },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            posts: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
            profile: null,
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'cursor() applies forward and backward boundaries using order direction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = createTestContract();
        const users = new Collection({ contract, runtime }, 'User');

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com' },
          { id: 2, name: 'B', email: 'b@example.com' },
          { id: 3, name: 'C', email: 'c@example.com' },
          { id: 4, name: 'D', email: 'd@example.com' },
        ]);

        const afterAscendingCursor = await users
          .orderBy((user) => user.id.asc())
          .cursor({ id: 2 })
          .all()
          .toArray();
        expect(afterAscendingCursor.map((row) => row.id)).toEqual([3, 4]);

        const afterDescendingCursor = await users
          .orderBy((user) => user.id.desc())
          .cursor({ id: 3 })
          .all()
          .toArray();
        expect(afterDescendingCursor.map((row) => row.id)).toEqual([2, 1]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateCount() returns matched row count and updates data',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = createTestContract();
        const users = new Collection({ contract, runtime }, 'User');

        await seedUsers(runtime, [
          { id: 1, name: 'Stale', email: 'a@example.com' },
          { id: 2, name: 'Stale', email: 'b@example.com' },
          { id: 3, name: 'Fresh', email: 'c@example.com' },
        ]);

        const count = await users.where({ name: 'Stale' }).updateCount({ name: 'Updated' });
        expect(count).toBe(2);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 1, name: 'Updated' },
          { id: 2, name: 'Updated' },
          { id: 3, name: 'Fresh' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteCount() returns matched row count and deletes data',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = createTestContract();
        const users = new Collection({ contract, runtime }, 'User');

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Remove', email: 'b@example.com' },
          { id: 3, name: 'Keep', email: 'c@example.com' },
        ]);

        const count = await users.where({ name: 'Remove' }).deleteCount();
        expect(count).toBe(2);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 3, name: 'Keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() returns inserted row when returning capability is enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = withReturningCapability(createTestContract());
        const users = new Collection({ contract, runtime }, 'User');

        const created = await users.create({ id: 9, name: 'Neo', email: 'neo@example.com' });
        expect(created).toEqual({ id: 9, name: 'Neo', email: 'neo@example.com' });

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users where id = $1',
          [9],
        );
        expect(rows).toEqual([{ id: 9, name: 'Neo' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() uses primary key conflict fallback and returns updated row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = withReturningCapability(createTestContract());
        const users = new Collection({ contract, runtime }, 'User');

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const upserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com' },
          update: { name: 'Alice Updated' },
        });

        expect(upserted).toEqual({
          id: 1,
          name: 'Alice Updated',
          email: 'alice@example.com',
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() with include() and select() keeps selected scalars and relation rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = withReturningCapability(createTestContract());
        const users = new Collection({ contract, runtime }, 'User');

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('name')
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .update({ name: 'Alice Updated' });

        expect(updated).toEqual({
          name: 'Alice Updated',
          posts: [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 1, views: 200 },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
