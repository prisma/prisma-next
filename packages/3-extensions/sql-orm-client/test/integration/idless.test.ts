import { describe, expect, it } from 'vitest';
import {
  createIdlessTagsCollection,
  createIdlessUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/idless', () => {
  it(
    'updateCount() returns matched row count on an id-less model and updates data',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createIdlessTagsCollection(runtime);

        await runtime.query(`insert into tags (id, name) values ('a', 'old-1')`);
        await runtime.query(`insert into tags (id, name) values ('b', 'old-2')`);
        await runtime.query(`insert into tags (id, name) values ('c', 'fresh')`);

        const count = await tags.where({ name: 'old-1' }).updateCount({ name: 'new-1' });
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags order by id',
        );
        expect(rows).toEqual([
          { id: 'a', name: 'new-1' },
          { id: 'b', name: 'old-2' },
          { id: 'c', name: 'fresh' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteCount() returns matched row count on an id-less model and deletes the row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createIdlessTagsCollection(runtime);

        await runtime.query(`insert into tags (id, name) values ('a', 'keep')`);
        await runtime.query(`insert into tags (id, name) values ('b', 'drop')`);

        const count = await tags.where({ name: 'drop' }).deleteCount();
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags order by id',
        );
        expect(rows).toEqual([{ id: 'a', name: 'keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateCount() returns zero for an id-less model when no rows match',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createIdlessTagsCollection(runtime);

        await runtime.query(`insert into tags (id, name) values ('a', 'untouched')`);

        const count = await tags.where({ name: 'absent' }).updateCount({ name: 'never' });
        expect(count).toBe(0);

        const rows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags order by id',
        );
        expect(rows).toEqual([{ id: 'a', name: 'untouched' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'nested update() reloads via row-identity criterion on an id-less table with a unique constraint',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createIdlessUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const updated = await users.where({ email: 'alice@example.com' }).update({
          name: 'Alice Updated',
          posts: (posts: { create: (data: readonly Record<string, unknown>[]) => unknown }) =>
            posts.create([{ id: 100, title: 'Nested post', userId: 1, views: 0 }]),
        } as never);

        expect(updated).toMatchObject({ name: 'Alice Updated', email: 'alice@example.com' });

        const posts = await runtime.query<{ id: number; title: string; user_id: number }>(
          'select id, title, user_id from posts',
        );
        expect(posts).toEqual([{ id: 100, title: 'Nested post', user_id: 1 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
