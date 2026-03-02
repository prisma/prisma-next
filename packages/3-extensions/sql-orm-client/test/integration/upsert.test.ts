import { describe, expect, it } from 'vitest';
import { createReturningUsersCollection, timeouts, withCollectionRuntime } from './helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/upsert', () => {
  it(
    'upsert() uses primary key conflict fallback and returns updated row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const upserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          update: { name: 'Alice Updated' },
        });

        expect(upserted).toEqual({
          id: 1,
          name: 'Alice Updated',
          email: 'alice@example.com',
          invitedById: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
