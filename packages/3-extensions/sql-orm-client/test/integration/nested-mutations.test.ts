import { describe, expect, it } from 'vitest';
import type { RelationMutator } from '../../src/types';
import type { TestContract } from '../helpers';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

describe('integration/nested-mutations', () => {
  it(
    'create() supports nested create() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .create({
            id: 1,
            name: 'Nested User',
            email: 'nested@example.com',
            // TODO: why do we need the explicit type annotation? we don't want it
            posts: (posts: RelationMutator<TestContract, 'Post'>) =>
              posts.create([
                { id: 10, title: 'First nested post', views: 100 },
                { id: 11, title: 'Second nested post', views: 200 },
              ]),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Nested User',
          email: 'nested@example.com',
          posts: [
            { id: 10, title: 'First nested post', userId: 1, views: 100 },
            { id: 11, title: 'Second nested post', userId: 1, views: 200 },
          ],
        });

        const postRows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(postRows).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() supports nested connect() on to-one relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        await seedUsers(runtime, [{ id: 5, name: 'Author', email: 'author@example.com' }]);

        const created = await posts.create({
          id: 20,
          title: 'Connected Post',
          views: 7,
          author: (author) => author.connect({ id: 5 }),
        });

        expect(created).toEqual({
          id: 20,
          title: 'Connected Post',
          userId: 5,
          views: 7,
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts where id = $1',
          [20],
        );
        expect(rows).toEqual([{ id: 20, user_id: 5 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() supports deep nested create() across three levels',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const updated = await users
          .where({ id: 1 })
          .include('posts', (posts) =>
            posts
              .orderBy((post) => post.id.asc())
              .include('comments', (comments) => comments.orderBy((comment) => comment.id.asc())),
          )
          .update({
            posts: (posts) =>
              posts.create([
                {
                  id: 30,
                  title: 'Deep Post',
                  views: 300,
                  comments: (comments) =>
                    comments.create([
                      {
                        id: 40,
                        body: 'Deep Comment',
                      },
                    ]),
                },
              ]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: [
            {
              id: 30,
              title: 'Deep Post',
              userId: 1,
              views: 300,
              comments: [{ id: 40, body: 'Deep Comment', postId: 30 }],
            },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() supports disconnect() with criteria on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Keep', userId: 1, views: 10 },
          { id: 11, title: 'Disconnect', userId: 1, views: 11 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .update({
            posts: (posts) => posts.disconnect([{ id: 11 }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: [{ id: 10, title: 'Keep', userId: 1, views: 10 }],
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(rows).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() supports disconnect() on to-one relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Profile' }]);

        const updated = await users
          .where({ id: 1 })
          .include('profile')
          .update({
            profile: (profile) => profile.disconnect(),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          profile: null,
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from profiles where id = $1',
          [100],
        );
        expect(rows).toEqual([{ id: 100, user_id: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
