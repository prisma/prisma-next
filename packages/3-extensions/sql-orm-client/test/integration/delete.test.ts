import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/delete', () => {
  it(
    'deleteCount() returns matched row count and deletes data',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

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
    'delete() returns deleted row and null when no row matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Keep', email: 'b@example.com' },
        ]);

        const deleted = await users.where({ id: 1 }).delete();
        expect(deleted).toEqual({
          id: 1,
          name: 'Remove',
          email: 'a@example.com',
          invitedById: null,
        });

        const missing = await users.where({ id: 999 }).delete();
        expect(missing).toBeNull();

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 2, name: 'Keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteAll() returns all deleted rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Remove', email: 'b@example.com' },
          { id: 3, name: 'Keep', email: 'c@example.com' },
        ]);

        const deleted = await users.where({ name: 'Remove' }).deleteAll();
        expect(deleted).toHaveLength(2);
        expect(deleted).toEqual(
          expect.arrayContaining([
            { id: 1, name: 'Remove', email: 'a@example.com', invitedById: null },
            { id: 2, name: 'Remove', email: 'b@example.com', invitedById: null },
          ]),
        );

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 3, name: 'Keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() and deleteAll() reject when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);
        const filtered = users.where({ id: 1 });

        await expect(filtered.delete()).rejects.toThrow(/requires contract capability "returning"/);
        expect(() => filtered.deleteAll()).toThrow(/requires contract capability "returning"/);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
