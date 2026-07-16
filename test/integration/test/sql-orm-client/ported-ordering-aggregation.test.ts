import { and, type NumericFieldNames } from '@prisma-next/sql-orm-client';
import { describe, expect, it } from 'vitest';
import type { getTestContract } from './helpers';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

type NumericPostField = NumericFieldNames<ReturnType<typeof getTestContract>, 'Post'>;
const viewsField: NumericPostField = 'views';

function byUserThenViews(
  left: { userId: number | null; views: number | null },
  right: { userId: number | null; views: number | null },
): number {
  return Number(left.userId) - Number(right.userId) || Number(left.views) - Number(right.views);
}

function byUser(left: { userId: number | null }, right: { userId: number | null }): number {
  return Number(left.userId) - Number(right.userId);
}

describe('integration/ported-ordering-aggregation', () => {
  it(
    '#41 multi-field orderBy honours name, then email, then id precedence',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 3, name: 'Ann', email: 'a@example.com' },
          { id: 1, name: 'Ann', email: 'a@example.com' },
          { id: 2, name: 'Ann', email: 'b@example.com' },
          { id: 4, name: 'Bob', email: 'a@example.com' },
        ]);

        const rows = await users
          .select('id', 'name', 'email')
          .orderBy([(u) => u.name.asc(), (u) => u.email.asc(), (u) => u.id.asc()])
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Ann', email: 'a@example.com' },
          { id: 3, name: 'Ann', email: 'a@example.com' },
          { id: 2, name: 'Ann', email: 'b@example.com' },
          { id: 4, name: 'Bob', email: 'a@example.com' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#42 multi-field orderBy with mixed asc/desc directions',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Ann', email: '1@example.com' },
          { id: 2, name: 'Ann', email: '2@example.com' },
          { id: 3, name: 'Bob', email: '3@example.com' },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy([(u) => u.name.desc(), (u) => u.id.desc()])
          .all();

        expect(rows).toEqual([
          { id: 3, name: 'Bob' },
          { id: 2, name: 'Ann' },
          { id: 1, name: 'Ann' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#43 chained orderBy calls append into a combined sort order',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Ann', email: '1@example.com' },
          { id: 2, name: 'Ann', email: '2@example.com' },
          { id: 3, name: 'Bob', email: '3@example.com' },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.name.asc())
          .orderBy((u) => u.id.desc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'Ann' },
          { id: 1, name: 'Ann' },
          { id: 3, name: 'Bob' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#44 orderBy desc on a single field',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Ann', email: '1@example.com' },
          { id: 2, name: 'Bob', email: '2@example.com' },
          { id: 3, name: 'Cat', email: '3@example.com' },
        ]);

        const rows = await users
          .select('id')
          .orderBy((u) => u.id.desc())
          .all();

        expect(rows).toEqual([{ id: 3 }, { id: 2 }, { id: 1 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#45 cursor on the last record returns an empty page (exclusive boundary)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: '1@example.com' },
          { id: 2, name: 'B', email: '2@example.com' },
          { id: 3, name: 'C', email: '3@example.com' },
          { id: 4, name: 'D', email: '4@example.com' },
          { id: 5, name: 'E', email: '5@example.com' },
        ]);

        const rows = await users
          .select('id')
          .orderBy((u) => u.id.asc())
          .cursor({ id: 5 })
          .all();

        expect(rows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#46 cursor combined with take returns a bounded page after the cursor (exclusive)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: '1@example.com' },
          { id: 2, name: 'B', email: '2@example.com' },
          { id: 3, name: 'C', email: '3@example.com' },
          { id: 4, name: 'D', email: '4@example.com' },
        ]);

        const rows = await users
          .select('id')
          .orderBy((u) => u.id.asc())
          .cursor({ id: 2 })
          .take(2)
          .all();

        expect(rows).toEqual([{ id: 3 }, { id: 4 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#47 cursor with a descending order walks backwards after the cursor (exclusive)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: '1@example.com' },
          { id: 2, name: 'B', email: '2@example.com' },
          { id: 3, name: 'C', email: '3@example.com' },
          { id: 4, name: 'D', email: '4@example.com' },
          { id: 5, name: 'E', email: '5@example.com' },
        ]);

        const rows = await users
          .select('id')
          .orderBy((u) => u.id.desc())
          .cursor({ id: 5 })
          .take(3)
          .all();

        expect(rows).toEqual([{ id: 4 }, { id: 3 }, { id: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#48 count() over the whole unfiltered collection',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);

        const stats = await users.aggregate((a) => ({ count: a.count() }));

        expect(stats).toEqual({ count: 3 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#49 sum over the whole unfiltered collection',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'A', userId: null, views: 5 },
          { id: 2, title: 'B', userId: null, views: 10 },
        ]);

        const stats = await posts.aggregate((a) => ({ total: a.sum(viewsField) }));

        expect(stats).toEqual({ total: 15 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#50 multiple aggregate functions in one call without a filter',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'A', userId: null, views: 5 },
          { id: 2, title: 'B', userId: null, views: 10 },
          { id: 3, title: 'C', userId: null, views: 30 },
        ]);

        const stats = await posts.aggregate((a) => ({
          count: a.count(),
          total: a.sum(viewsField),
          avg: a.avg(viewsField),
          min: a.min(viewsField),
          max: a.max(viewsField),
        }));

        expect(stats).toEqual({ count: 3, total: 45, avg: 15, min: 5, max: 30 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#51 groupBy on multiple fields',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'A', userId: 1, views: 10 },
          { id: 2, title: 'B', userId: 1, views: 10 },
          { id: 3, title: 'C', userId: 1, views: 20 },
          { id: 4, title: 'D', userId: 2, views: 10 },
        ]);

        const grouped = await posts
          .groupBy('userId', 'views')
          .aggregate((a) => ({ count: a.count() }));

        expect([...grouped].sort(byUserThenViews)).toEqual([
          { userId: 1, views: 10, count: 2 },
          { userId: 1, views: 20, count: 1 },
          { userId: 2, views: 10, count: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#52 groupBy returns an empty result over an empty table',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        const grouped = await posts.groupBy('userId').aggregate((a) => ({ count: a.count() }));

        expect(grouped).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#53 having(sum().gt()) filters groups by a summed metric',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'A', userId: 1, views: 10 },
          { id: 2, title: 'B', userId: 1, views: 20 },
          { id: 3, title: 'C', userId: 2, views: 10 },
          { id: 4, title: 'D', userId: 3, views: 30 },
        ]);

        const grouped = await posts
          .groupBy('userId')
          .having((h) => h.sum(viewsField).gt(25))
          .aggregate((a) => ({ total: a.sum(viewsField) }));

        expect([...grouped].sort(byUser)).toEqual([
          { userId: 1, total: 30 },
          { userId: 3, total: 30 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#54 having(avg().gte()) filters groups by an averaged metric',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'A', userId: 1, views: 10 },
          { id: 2, title: 'B', userId: 1, views: 20 },
          { id: 3, title: 'C', userId: 2, views: 10 },
          { id: 4, title: 'D', userId: 2, views: 10 },
          { id: 5, title: 'E', userId: 3, views: 30 },
        ]);

        const grouped = await posts
          .groupBy('userId')
          .having((h) => h.avg(viewsField).gte(15))
          .aggregate((a) => ({ avg: a.avg(viewsField) }));

        expect([...grouped].sort(byUser)).toEqual([
          { userId: 1, avg: 15 },
          { userId: 3, avg: 30 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#55 where() before groupBy filters rows before grouping (multi-field group)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 5 },
          { id: 11, title: 'B', userId: 1, views: 5 },
          { id: 12, title: 'C', userId: 1, views: 10 },
          { id: 20, title: 'D', userId: 2, views: 5 },
          { id: 3, title: 'E', userId: 1, views: 3 },
        ]);

        const grouped = await posts
          .where((p) => and(p.views.gte(5), p.id.lt(15)))
          .groupBy('userId', 'views')
          .aggregate((a) => ({ count: a.count() }));

        expect([...grouped].sort(byUserThenViews)).toEqual([
          { userId: 1, views: 5, count: 2 },
          { userId: 1, views: 10, count: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#56 distinct on multiple fields dedupes on the composite key',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Ann', email: 'a@example.com' },
          { id: 2, name: 'Ann', email: 'a@example.com' },
          { id: 3, name: 'Bob', email: 'b@example.com' },
          { id: 4, name: 'Ann', email: 'c@example.com' },
        ]);

        const rows = await users
          .select('id', 'name', 'email')
          .distinct('name', 'email')
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Ann', email: 'a@example.com' },
          { id: 3, name: 'Bob', email: 'b@example.com' },
          { id: 4, name: 'Ann', email: 'c@example.com' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#57 distinct over an empty table returns no rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        const rows = await users.distinct('name', 'email').all();

        expect(rows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#58 distinct combined with skip',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Ann', email: 'a@example.com' },
          { id: 2, name: 'Ann', email: 'a@example.com' },
          { id: 3, name: 'Bob', email: 'b@example.com' },
          { id: 4, name: 'Cat', email: 'c@example.com' },
        ]);

        const rows = await users
          .orderBy((u) => u.id.asc())
          .distinct('name', 'email')
          .skip(1)
          .all();

        expect(rows).toEqual([
          { id: 3, name: 'Bob', email: 'b@example.com', invitedById: null, address: null },
          { id: 4, name: 'Cat', email: 'c@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#59 regression: distinct fields need not appear in the selection',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Ann', email: 'a@example.com' },
          { id: 2, name: 'Ann', email: 'a@example.com' },
          { id: 3, name: 'Bob', email: 'b@example.com' },
        ]);

        // Dedup keys (name, email) are not in the projection. This is a
        // no-panic regression guard: dedup still collapses to one row per
        // (name, email) pair even though only `id` is projected. Without an
        // orderBy the surviving row per partition is implementation-defined,
        // so the exact id is not asserted — only the deduped row count and
        // the single-scalar shape.
        const rows = await users.select('id').distinct('name', 'email').all();

        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(Object.keys(row)).toEqual(['id']);
          expect(typeof row.id).toBe('number');
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#60 select narrows to a single scalar field at result level',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);

        const rows = await users.select('email').all();

        expect([...rows].sort((left, right) => left.email.localeCompare(right.email))).toEqual([
          { email: 'alice@example.com' },
          { email: 'bob@example.com' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
