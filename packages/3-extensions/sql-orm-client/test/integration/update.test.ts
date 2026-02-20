import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

describe('integration/update', () => {
  it(
    'updateCount() returns matched row count and updates data',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

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
    'update() with include() and select() keeps selected scalars and relation rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

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
