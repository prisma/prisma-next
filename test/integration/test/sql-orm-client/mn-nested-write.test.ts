// Integration coverage for M:N nested writes through the junction table.
//
// Two M:N relations on User are exercised:
//
//   User.tags  — pure junction (user_tags: user_id, tag_id).
//                connect / disconnect / create are all supported.
//
//   User.roles — required-payload junction (user_roles: user_id, role_id,
//                level NOT NULL). connect and create both throw a runtime guard
//                error; only disconnect is allowed.
//
// Standard:
//   1. Whole-row toEqual on the readback (via include('tags') / include('roles')).
//   2. Explicit .select() used in most tests.
//   3. At least one implicit/default-selection readback.

import type { Char } from '@prisma-next/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedRoles, seedTags, seedUserRoles, seedUsers, seedUserTags } from './runtime-helpers';

const TAG_RUST = 'tag-rust' as Char<36>;
const TAG_TS = 'tag-typescript' as Char<36>;
const ROLE_ADMIN = 'role-admin' as Char<36>;
const ROLE_EDITOR = 'role-editor' as Char<36>;

describe('integration/mn-nested-write', () => {
  // ===========================================================================
  // connect — create() parent flow
  // ===========================================================================

  it(
    'create(): connect links an existing tag via junction; include("tags") readback reflects the link (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => t.connect({ id: TAG_RUST }),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): connect links multiple existing tags; include("tags") readback contains all (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .create({
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            tags: (t) => t.connect([{ id: TAG_RUST }, { id: TAG_TS }]),
          });

        expect(created).toEqual({
          id: 2,
          name: 'Bob',
          tags: [
            { id: TAG_RUST, name: 'Rust' },
            { id: TAG_TS, name: 'TypeScript' },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // connect — update() parent flow
  // ===========================================================================

  it(
    'update(): connect links an existing tag to an existing user; include("tags") readback reflects the link (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .update({
            tags: (t) => t.connect({ id: TAG_RUST }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // disconnect — update() parent flow (only supported path)
  // ===========================================================================

  it(
    'update(): disconnect removes the junction link; include("tags") readback no longer contains the tag (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .update({
            tags: (t) => t.disconnect([{ id: TAG_RUST }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_TS, name: 'TypeScript' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags order by tag_id',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_TS }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): disconnect all tags leaves an empty junction; include("tags") returns [] (implicit selection)',
    async () => {
      // Standard requirement: at least one test without .select() on the
      // parent so the full default row shape is asserted.
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        const updated = await users
          .where({ id: 1 })
          .include('tags', (tags) => tags.orderBy((t) => t.name.asc()))
          .update({
            tags: (t) => t.disconnect([{ id: TAG_RUST }]),
          });

        // Full User shape + tags: [] (junction row deleted, no .select() on parent).
        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          tags: [],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // nested create — pure junction (User.tags, no required payload columns)
  // ===========================================================================

  it(
    'create(): nested create inserts the Tag row and the junction link; include("tags") readback reflects both (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => t.create([{ id: TAG_RUST, name: 'Rust' }]),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const tagRows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags',
        );
        expect(tagRows).toEqual([{ id: TAG_RUST, name: 'Rust' }]);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): nested create inserts Tag rows and junction links; include("tags") readback reflects all (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .update({
            tags: (t) =>
              t.create([
                { id: TAG_RUST, name: 'Rust' },
                { id: TAG_TS, name: 'TypeScript' },
              ]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [
            { id: TAG_RUST, name: 'Rust' },
            { id: TAG_TS, name: 'TypeScript' },
          ],
        });

        const tagRows = await runtime.query<{ id: string }>('select id from tags order by id');
        expect(tagRows).toEqual([{ id: TAG_RUST }, { id: TAG_TS }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Runtime disable: nested create on required-payload junction (User.roles)
  // ===========================================================================

  it(
    'create(): nested create on User.roles throws because the junction has a required payload column (level)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            roles: (r) => r.create([{ id: ROLE_ADMIN, name: 'Admin' }]),
          }),
        ).rejects.toThrow(/required column.*`level`/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // connect/disconnect on required-payload junction (User.roles) — must succeed
  // ===========================================================================

  it(
    'create(): connect on User.roles throws because the junction has a required payload column (level)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedRoles(runtime, [{ id: ROLE_ADMIN, name: 'Admin' }]);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            roles: (r) => r.connect({ id: ROLE_ADMIN }),
          }),
        ).rejects.toThrow(/required column.*`level`/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): disconnect on User.roles deletes the junction link; include("roles") readback is empty (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedRoles(runtime, [
          { id: ROLE_ADMIN, name: 'Admin' },
          { id: ROLE_EDITOR, name: 'Editor' },
        ]);
        await seedUserRoles(runtime, [
          { userId: 1, roleId: ROLE_ADMIN, level: 5 },
          { userId: 1, roleId: ROLE_EDITOR, level: 3 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('roles', (roles) => roles.select('id', 'name'))
          .update({
            roles: (r) => r.disconnect([{ id: ROLE_ADMIN }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          roles: [{ id: ROLE_EDITOR, name: 'Editor' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; role_id: string }>(
          'select user_id, role_id from user_roles',
        );
        expect(junctionRows).toEqual([{ user_id: 1, role_id: ROLE_EDITOR }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
