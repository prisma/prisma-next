import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/self-relations', () => {
  it(
    'include() resolves users -> invitedUsers (1:N) on the same model',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedUsers: [
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [
              { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2, address: null },
            ],
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [],
          },
          {
            id: 4,
            name: 'Dan',
            email: 'dan@example.com',
            invitedById: 2,
            address: null,
            invitedUsers: [],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() resolves users -> invitedBy (N:1) on the same model',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedBy')
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedBy: null,
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            address: null,
            invitedBy: {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
            },
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 2,
            address: null,
            invitedBy: {
              id: 2,
              name: 'Bob',
              email: 'bob@example.com',
              invitedById: 1,
              address: null,
            },
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
