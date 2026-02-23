import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './helpers';
import { seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

describe('integration/include', () => {
  it(
    'include() stitches one-to-many and one-to-one relations from real rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

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
          .all();

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
});
