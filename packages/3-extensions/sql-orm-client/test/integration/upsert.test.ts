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

  it(
    'upsert() with empty update behaves as conditional create',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const inserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com' },
          update: {},
        });

        expect(inserted).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        });

        const existing = await users.upsert({
          create: { id: 1, name: 'Ignored', email: 'ignored@example.com' },
          update: {},
        });

        expect(existing).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        });

        const rows = await runtime.query<{ id: number; name: string; email: string }>(
          'select id, name, email from users where id = $1',
          [1],
        );
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
