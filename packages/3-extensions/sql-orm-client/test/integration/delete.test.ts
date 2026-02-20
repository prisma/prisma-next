import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './helpers';
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
});
