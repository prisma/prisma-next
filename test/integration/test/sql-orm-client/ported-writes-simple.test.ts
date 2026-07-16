import { Collection } from '@prisma-next/sql-orm-client';
import type { Char } from '@prisma-next/target-postgres/codec-types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { getTestContext } from './helpers';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedUserRoles, seedUsers } from './runtime-helpers';

// UserRole.roleId is typed `Char<36>` in the test contract; the runtime value is
// an ordinary string, so brand it once through the sanctioned cast helper.
const ROLE_ID = blindCast<Char<36>, 'test char36 role id used as a UserRole composite key'>(
  '11111111-1111-4111-8111-111111111111',
);

// UserTag.tagId is likewise typed `Char<36>`; brand the runtime string once.
const TAG_ID = blindCast<Char<36>, 'test char36 tag id used as a UserTag composite key'>(
  '22222222-2222-4222-8222-222222222222',
);

describe('integration/ported-writes-simple', () => {
  it(
    '61. createCount() returns 3 for a 3-row batch with mixed optional fields',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        const count = await users.createCount([
          { id: 1, name: '1', email: 'a', invitedById: null },
          { id: 2, name: '2', email: 'b' },
          { id: 3, name: '1', email: 'c' },
        ]);
        expect(count).toBe(3);

        const rows = await users.orderBy((u) => u.id.asc()).all();
        expect(rows).toEqual([
          { id: 1, name: '1', email: 'a', invitedById: null, address: null },
          { id: 2, name: '2', email: 'b', invitedById: null, address: null },
          { id: 3, name: '1', email: 'c', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '62. updateCount() returns 0 when the filter matches no rows and mutates nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);

        const count = await users.where({ id: 999 }).updateCount({ name: 'x' });
        expect(count).toBe(0);

        const rows = await users.orderBy((u) => u.id.asc()).all();
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '63. updateAll() returns [] when the filter matches no rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);

        const updated = await users.where({ id: 999 }).updateAll({ name: 'x' });
        expect(updated).toEqual([]);

        const rows = await users.orderBy((u) => u.id.asc()).all();
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '64. deleteCount() returns 0 when the filter matches no rows and leaves the table unchanged',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);

        const count = await users.where({ id: 999 }).deleteCount();
        expect(count).toBe(0);

        const rows = await users.orderBy((u) => u.id.asc()).all();
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '65. upsert() inserts a new row via the create branch when no conflict exists',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const upserted = await users.upsert({
          create: { id: 5, name: 'New', email: 'new@example.com', invitedById: null },
          update: { name: 'Ignored' },
        });

        expect(upserted).toEqual({
          id: 5,
          name: 'New',
          email: 'new@example.com',
          invitedById: null,
          address: null,
        });

        expect(await users.first({ id: 5 })).toEqual({
          id: 5,
          name: 'New',
          email: 'new@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '66. create() and read-back round-trip a jsonb value-object address (with zip: null)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users.create({
          id: 1,
          name: 'A',
          email: 'a',
          invitedById: null,
          address: { street: 's', city: 'c', zip: null },
        });
        expect(created).toEqual({
          id: 1,
          name: 'A',
          email: 'a',
          invitedById: null,
          address: { street: 's', city: 'c', zip: null },
        });

        expect(await users.first({ id: 1 })).toEqual({
          id: 1,
          name: 'A',
          email: 'a',
          invitedById: null,
          address: { street: 's', city: 'c', zip: null },
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '94. create() of a Post with several scalar fields echoes each set value',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        const created = await posts.create({ id: 1, title: 'Hello', userId: 7, views: 1337 });
        expect(created).toEqual({
          id: 1,
          title: 'Hello',
          userId: 7,
          views: 1337,
          embedding: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '95. create() round-trips a unicode / special-character string exactly',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users.create({
          id: 1,
          name: 'test¥฿😀ऀ€',
          email: 'a',
          invitedById: null,
        });
        expect(created).toEqual({
          id: 1,
          name: 'test¥฿😀ऀ€',
          email: 'a',
          invitedById: null,
          address: null,
        });

        expect(await users.first({ id: 1 })).toEqual({
          id: 1,
          name: 'test¥฿😀ऀ€',
          email: 'a',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '96. update() sets multiple scalar fields in a single call',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Old', email: 'old@example.com' }]);

        const updated = await users
          .where({ id: 1 })
          .update({ name: 'Renamed', email: 'new@example.com' });
        expect(updated).toEqual({
          id: 1,
          name: 'Renamed',
          email: 'new@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '97. update() filtered by a unique field that is not the primary key',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const updated = await users
          .where({ email: 'alice@example.com' })
          .update({ name: 'Renamed' });
        expect(updated).toEqual({
          id: 1,
          name: 'Renamed',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '98. update() sets a nullable field from null to a non-null value',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);

        const updated = await users.where({ id: 1 }).update({ invitedById: 2 });
        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: 2,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '99. all() over an empty table returns []',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        expect(await users.all()).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '100. a two-field composite where returns the single matching row, or null when absent',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = new Collection({ runtime, context: getTestContext() }, 'UserRole', {
          namespaceId: 'public',
        });

        await seedUserRoles(runtime, [{ userId: 1, roleId: ROLE_ID, level: 5 }]);

        const found = await userRoles.where({ userId: 1, roleId: ROLE_ID }).first();
        expect(found).toEqual({ userId: 1, roleId: ROLE_ID, level: 5 });

        const missing = await userRoles.where({ userId: 9, roleId: ROLE_ID }).first();
        expect(missing).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '101. first() with no argument returns a row from a non-empty collection',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        expect(await users.first()).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '102. create() omitting a field with a column-level SQL default populates it from the DB default',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userTags = new Collection({ runtime, context: getTestContext() }, 'UserTag', {
          namespaceId: 'public',
        });

        // Omit createdAt (defaultSql('now()')) so the DB default fills it in.
        const count = await userTags.createCount([{ userId: 1, tagId: TAG_ID }]);
        expect(count).toBe(1);

        const found = await userTags.where({ userId: 1, tagId: TAG_ID }).first();
        // createdAt is a nondeterministic now() default, so match it by type;
        // expect.any(String) still fails on null, asserting it was populated.
        expect(found).toEqual({
          userId: 1,
          tagId: TAG_ID,
          note: null,
          createdAt: expect.any(String),
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
