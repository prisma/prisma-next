import { describe, expect, it } from 'vitest';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

describe('integration/ported-filters-scalar', () => {
  it(
    '#1 neq on a text field returns non-matching rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'bar', email: 'u1@example.com' },
          { id: 2, name: 'foo bar', email: 'u2@example.com' },
          { id: 3, name: 'foo bar barz', email: 'u3@example.com' },
        ]);

        const rows = await users
          .where((u) => u.name.neq('bar'))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'foo bar', email: 'u2@example.com', invitedById: null, address: null },
          {
            id: 3,
            name: 'foo bar barz',
            email: 'u3@example.com',
            invitedById: null,
            address: null,
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#2 neq on an int field returns non-matching rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts
          .where((p) => p.views.neq(1))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, title: 'P2', userId: null, views: 2, embedding: null },
          { id: 3, title: 'P3', userId: null, views: 3, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#3 eq on an int field returns the single matching row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts.where((p) => p.views.eq(1)).all();

        expect(rows).toEqual([{ id: 1, title: 'P1', userId: null, views: 1, embedding: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#4 implicit shorthand equals maps { field: value } to =',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'John', email: 'john@example.com' },
          { id: 2, name: 'Jane', email: 'jane@example.com' },
        ]);

        const rows = await users.where({ name: 'John' }).all();

        expect(rows).toEqual([
          { id: 1, name: 'John', email: 'john@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#5 shorthand { field: null } lowers to IS NULL and matches null rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com', invitedById: null },
          { id: 2, name: 'B', email: 'b@example.com', invitedById: 1 },
          { id: 3, name: 'C', email: 'c@example.com', invitedById: null },
        ]);

        const rows = await users
          .where({ invitedById: null })
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'A', email: 'a@example.com', invitedById: null, address: null },
          { id: 3, name: 'C', email: 'c@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#6 in on a text field with a multi-value list',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Bernd', email: 'bernd@example.com' },
          { id: 2, name: 'Michael', email: 'michael@example.com' },
          { id: 3, name: 'Paul', email: 'paul@example.com' },
        ]);

        const rows = await users
          .where((u) => u.name.in(['Bernd', 'Paul']))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Bernd', email: 'bernd@example.com', invitedById: null, address: null },
          { id: 3, name: 'Paul', email: 'paul@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#7 in with a single-element list',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'a', email: 'a@example.com' },
          { id: 2, name: 'b', email: 'b@example.com' },
        ]);

        const rows = await users.where((u) => u.name.in(['a'])).all();

        expect(rows).toEqual([
          { id: 1, name: 'a', email: 'a@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#8 in([]) returns no rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'a', email: 'a@example.com' },
          { id: 2, name: 'b', email: 'b@example.com' },
        ]);

        const rows = await users.where((u) => u.name.in([])).all();

        expect(rows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#9 in on an int field',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
        ]);

        const rows = await posts.where((p) => p.views.in([1])).all();

        expect(rows).toEqual([{ id: 1, title: 'P1', userId: null, views: 1, embedding: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#10 notIn on a text field excludes listed values',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Bernd', email: 'bernd@example.com' },
          { id: 2, name: 'Michael', email: 'michael@example.com' },
          { id: 3, name: 'Paul', email: 'paul@example.com' },
        ]);

        const rows = await users
          .where((u) => u.name.notIn(['Bernd', 'Paul']))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          {
            id: 2,
            name: 'Michael',
            email: 'michael@example.com',
            invitedById: null,
            address: null,
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#11 notIn([]) returns all rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com' },
          { id: 2, name: 'B', email: 'b@example.com' },
          { id: 3, name: 'C', email: 'c@example.com' },
        ]);

        const rows = await users
          .where((u) => u.name.notIn([]))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'A', email: 'a@example.com', invitedById: null, address: null },
          { id: 2, name: 'B', email: 'b@example.com', invitedById: null, address: null },
          { id: 3, name: 'C', email: 'c@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#12 notIn on an int field',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts
          .where((p) => p.views.notIn([1]))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, title: 'P2', userId: null, views: 2, embedding: null },
          { id: 3, title: 'P3', userId: null, views: 3, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#13 gt on an int field via all()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts.where((p) => p.views.gt(2)).all();

        expect(rows).toEqual([{ id: 3, title: 'P3', userId: null, views: 3, embedding: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#14 lt on an int field via all()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts
          .where((p) => p.views.lt(2))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([{ id: 1, title: 'P1', userId: null, views: 1, embedding: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#15 gte on an int field via all()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts
          .where((p) => p.views.gte(2))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, title: 'P2', userId: null, views: 2, embedding: null },
          { id: 3, title: 'P3', userId: null, views: 3, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#16 lte on an int field via all()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 1 },
          { id: 2, title: 'P2', userId: null, views: 2 },
          { id: 3, title: 'P3', userId: null, views: 3 },
        ]);

        const rows = await posts
          .where((p) => p.views.lte(2))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, title: 'P1', userId: null, views: 1, embedding: null },
          { id: 2, title: 'P2', userId: null, views: 2, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#17 gt on an int field at a precision boundary',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'P1', userId: null, views: 100 },
          { id: 2, title: 'P2', userId: null, views: 101 },
        ]);

        const rows = await posts.where((p) => p.views.gt(100)).all();

        expect(rows).toEqual([{ id: 2, title: 'P2', userId: null, views: 101, embedding: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#18 like prefix pattern',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Paul', email: 'paul@example.com' },
          { id: 2, name: 'Bernd', email: 'bernd@example.com' },
          { id: 3, name: 'Michael', email: 'michael@example.com' },
          { id: 4, name: 'John', email: 'john@example.com' },
        ]);

        const rows = await users.where((u) => u.name.like('P%')).all();

        expect(rows).toEqual([
          { id: 1, name: 'Paul', email: 'paul@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#19 like substring pattern',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Paul', email: 'paul@example.com' },
          { id: 2, name: 'Bernd', email: 'bernd@example.com' },
          { id: 3, name: 'Michael', email: 'michael@example.com' },
          { id: 4, name: 'John', email: 'john@example.com' },
        ]);

        const rows = await users
          .where((u) => u.name.like('%n%'))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'Bernd', email: 'bernd@example.com', invitedById: null, address: null },
          { id: 4, name: 'John', email: 'john@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#20 like suffix pattern',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'val1', email: 'v1@example.com' },
          { id: 2, name: 'val2', email: 'v2@example.com' },
          { id: 3, name: 'val3', email: 'v3@example.com' },
          { id: 4, name: 'val4', email: 'v4@example.com' },
          { id: 5, name: 'val5', email: 'v5@example.com' },
        ]);

        const rows = await users.where((u) => u.name.like('%5')).all();

        expect(rows).toEqual([
          { id: 5, name: 'val5', email: 'v5@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
