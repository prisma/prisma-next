import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/pagination', () => {
  it(
    'cursor() applies forward and backward boundaries using order direction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com' },
          { id: 2, name: 'B', email: 'b@example.com' },
          { id: 3, name: 'C', email: 'c@example.com' },
          { id: 4, name: 'D', email: 'd@example.com' },
        ]);

        const afterAscendingCursor = await users
          .orderBy((user) => user.id.asc())
          .cursor({ id: 2 })
          .all();
        expect(afterAscendingCursor.map((row) => row.id)).toEqual([3, 4]);

        const afterDescendingCursor = await users
          .orderBy((user) => user.id.desc())
          .cursor({ id: 3 })
          .all();
        expect(afterDescendingCursor.map((row) => row.id)).toEqual([2, 1]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
