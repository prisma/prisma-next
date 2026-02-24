import { describe, expect, it } from 'vitest';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedComments, seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

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

  it(
    'include() supports scalar count() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'Comment A', postId: 10 },
          { id: 101, body: 'Comment B', postId: 10 },
          { id: 102, body: 'Comment C', postId: 12 },
        ]);

        runtime.resetExecutions();
        const rows = await posts
          .orderBy((post) => post.id.asc())
          .include('comments', (comments) => comments.count())
          .all();

        expect(rows).toEqual([
          { id: 10, title: 'Post A', userId: 1, views: 100, comments: 2 },
          { id: 11, title: 'Post B', userId: 1, views: 200, comments: 0 },
          { id: 12, title: 'Post C', userId: 2, views: 300, comments: 1 },
        ]);
        expect(runtime.executions).toHaveLength(2);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar sum() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const numericField = 'views' as never;
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) => posts.sum(numericField))
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', posts: 300 },
          { id: 2, name: 'Bob', email: 'bob@example.com', posts: 300 },
          { id: 3, name: 'Cara', email: 'cara@example.com', posts: null },
        ]);
        expect(runtime.executions).toHaveLength(2);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar avg(), min(), and max() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const numericField = 'views' as never;
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              avgViews: posts.avg(numericField),
              minViews: posts.min(numericField),
              maxViews: posts.max(numericField),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            posts: { avgViews: 150, minViews: 100, maxViews: 200 },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            posts: { avgViews: 300, minViews: 300, maxViews: 300 },
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            posts: { avgViews: null, minViews: null, maxViews: null },
          },
        ]);
        expect(runtime.executions).toHaveLength(4);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() combine() evaluates branches independently',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 250 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              popular: posts.where((post) => post.views.gte(200)).orderBy((post) => post.id.asc()),
              latestOne: posts.orderBy((post) => post.id.desc()).take(1),
              totalCount: posts.count(),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            posts: {
              popular: [{ id: 11, title: 'Post B', userId: 1, views: 250 }],
              latestOne: [{ id: 11, title: 'Post B', userId: 1, views: 250 }],
              totalCount: 2,
            },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            posts: {
              popular: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
              latestOne: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
              totalCount: 1,
            },
          },
        ]);
        expect(runtime.executions).toHaveLength(4);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
