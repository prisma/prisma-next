import { describe, expect, it } from 'vitest';
import { createReturningUsersCollection, timeouts, withCollectionRuntime } from './helpers';

describe('integration/create', () => {
  it(
    'create() returns inserted row when returning capability is enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users.create({ id: 9, name: 'Neo', email: 'neo@example.com' });
        expect(created).toEqual({ id: 9, name: 'Neo', email: 'neo@example.com' });

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users where id = $1',
          [9],
        );
        expect(rows).toEqual([{ id: 9, name: 'Neo' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
