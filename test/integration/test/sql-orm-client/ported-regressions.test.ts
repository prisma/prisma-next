// Ported upstream regressions — one test per `tests-ports.md` entry.
//
// Each test maps a behaviour ported from the upstream Prisma engine/client
// test suite into prisma-next. Entries are kept here so a future regression
// is caught at the same boundary the original port exercised.

import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/sql-orm-client ported regressions', () => {
  // Seed: Alice(id=1, invitedById=null) invited Bob(id=2, invitedById=1);
  //       Eve(id=3, invitedById=null) invited Frank(id=4, invitedById=3).
  //
  // `User.invitedUsers` is a self-referential 1:N relation via
  // `invited_by_id` — parent and child resolve to the same `users` table.
  // A relation predicate on it emits a correlated EXISTS whose child FROM
  // must alias the `users` table, or the inner reference shadows the outer
  // correlation and the predicate silently matches nothing.
  const seedSelfReferentialUsers = (runtime: Parameters<typeof seedUsers>[0]) =>
    seedUsers(runtime, [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
      { id: 3, name: 'Eve', email: 'eve@example.com' },
      { id: 4, name: 'Frank', email: 'frank@example.com', invitedById: 3 },
    ]);

  it(
    'entry 107: some filter on a self-referential one-to-many relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);
        await seedSelfReferentialUsers(runtime);

        const rows = await users
          .select('id', 'name')
          .where((u) => u.invitedUsers.some((invitee) => invitee.name.eq('Bob')))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([{ id: 1, name: 'Alice' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 107: none filter on a self-referential one-to-many relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);
        await seedSelfReferentialUsers(runtime);

        const rows = await users
          .select('id', 'name')
          .where((u) => u.invitedUsers.none((invitee) => invitee.name.eq('Bob')))
          .orderBy((u) => u.id.asc())
          .all();

        // Alice invited Bob → excluded. Bob, Eve, Frank invited nobody named
        // Bob → included.
        expect(rows).toEqual([
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Eve' },
          { id: 4, name: 'Frank' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 107: every filter on a self-referential one-to-many relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);
        await seedSelfReferentialUsers(runtime);

        const rows = await users
          .select('id', 'name')
          .where((u) => u.invitedUsers.every((invitee) => invitee.name.eq('Bob')))
          .orderBy((u) => u.id.asc())
          .all();

        // Alice invited only Bob → qualifies. Bob, Eve, Frank invited nobody
        // → vacuously true → qualify. Eve invited Frank (not Bob) → excluded.
        expect(rows).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 4, name: 'Frank' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
