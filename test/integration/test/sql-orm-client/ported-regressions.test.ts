// Ported upstream regression behaviours (ledger entries 105–110, 117–127).
//
// Each `it()` carries its ledger entry number. Reads, write returns, and
// read-backs assert the whole result shape per the
// `sql-orm-client-whole-shape-assertions` project rule.
//
// Entries 108, 118, and 119 could not be expressed against today's fixture /
// public API — see the accompanying port report for the reasons.

import { and, Collection } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Char } from '@prisma-next/target-postgres/codec-types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { withReturningCapability } from './collection-fixtures';
import { getTestContext, getTestContract, type TestContract } from './helpers';
import {
  createPostsCollection,
  createReturningPostsCollection,
  createReturningTagsCollection,
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import {
  type PgIntegrationRuntime,
  seedComments,
  seedPosts,
  seedUserRoles,
  seedUsers,
} from './runtime-helpers';

// The fixture ships no `UserRole` collection helper, so build one locally
// mirroring `integration-helpers.ts`. Composite-PK (userId, roleId) model.
function createUserRolesCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: getTestContext() }, 'UserRole', {
    namespaceId: 'public',
  });
}

function createReturningUserRolesCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'UserRole', { namespaceId: 'public' });
}

// UserRole.roleId is typed `Char<36>` in the test contract; the runtime value is
// an ordinary string, so brand it through the sanctioned cast helper for the
// composite-key `where` shorthand.
const asRoleId = (value: string) =>
  blindCast<Char<36>, 'UserRole composite-key roleId branded for the where shorthand'>(value);

describe('integration/ported-regressions', () => {
  // ===========================================================================
  // Regressions — filters & combinators (105)
  // ===========================================================================

  it(
    'entry 105: finds self-referential root nodes via eq AND isNull on the parent foreign key',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'root', email: 'root@example.com', invitedById: null },
          { id: 2, name: 'child', email: 'child@example.com', invitedById: 1 },
          // Named 'root' but not a top-level node — excluded by the isNull check.
          { id: 3, name: 'root', email: 'nested-root@example.com', invitedById: 1 },
        ]);

        const rows = await users
          .where((u) => and(u.name.eq('root'), u.invitedById.isNull()))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'root', email: 'root@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — relation filters (107)
  // ===========================================================================

  // Known bug: https://github.com/prisma/prisma-next/issues/980 — self-referential relation predicate returns []. Remove .fails once fixed.
  it.fails(
    'entry 107: some filter on a self-referential one-to-many relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Eve', email: 'eve@example.com', invitedById: null },
          { id: 4, name: 'Frank', email: 'frank@example.com', invitedById: 3 },
        ]);

        // Only Alice invited a user named Bob.
        const rows = await users
          .where((u) => u.invitedUsers.some((invitee) => invitee.name.eq('Bob')))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — pagination & cursors (109–110)
  // ===========================================================================

  it(
    'entry 109: composite multi-field cursor with parameterised values',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = createUserRolesCollection(runtime);

        await seedUserRoles(runtime, [
          { userId: 1, roleId: 'a', level: 10 },
          { userId: 1, roleId: 'b', level: 20 },
          { userId: 1, roleId: 'c', level: 30 },
          { userId: 2, roleId: 'a', level: 40 },
        ]);

        // Composite (userId, roleId) cursor: the boundary tuple is bound as
        // parameters, and the seek advances past (1, 'a') within user 1.
        const rows = await userRoles
          .where((r) => r.userId.eq(1))
          .orderBy([(r) => r.userId.asc(), (r) => r.roleId.asc()])
          .cursor({ userId: 1, roleId: 'a' })
          .skip(0)
          .take(5)
          .all();

        expect(rows).toEqual([
          { userId: 1, roleId: 'b', level: 20 },
          { userId: 1, roleId: 'c', level: 30 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 110: cursor combined with a multi-field orderBy and skip + take',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'p1', userId: 1, views: 80 },
          { id: 2, title: 'p2', userId: 1, views: 70 },
          { id: 3, title: 'p3', userId: 1, views: 70 },
          { id: 4, title: 'p4', userId: 1, views: 60 },
          { id: 5, title: 'p5', userId: 1, views: 50 },
          { id: 6, title: 'p6', userId: 1, views: 40 },
          { id: 7, title: 'p7', userId: 1, views: 30 },
          { id: 8, title: 'p8', userId: 1, views: 20 },
        ]);

        // Order [views desc, id asc] → (80,1),(70,2),(70,3),(60,4),(50,5),
        // (40,6),(30,7),(20,8). Cursor (views 70, id 2) then skip(1) drops
        // (70,3), leaving ids 4..8.
        const rows = await posts
          .orderBy([(p) => p.views.desc(), (p) => p.id.asc()])
          .cursor({ views: 70, id: 2 })
          .skip(1)
          .take(5)
          .all();

        expect(rows).toEqual([
          { id: 4, title: 'p4', userId: 1, views: 60, embedding: null },
          { id: 5, title: 'p5', userId: 1, views: 50, embedding: null },
          { id: 6, title: 'p6', userId: 1, views: 40, embedding: null },
          { id: 7, title: 'p7', userId: 1, views: 30, embedding: null },
          { id: 8, title: 'p8', userId: 1, views: 20, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — writes (117)
  // ===========================================================================

  it(
    'entry 117: create violating a unique constraint rejects',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createReturningTagsCollection(runtime);

        const first = await tags.create({ name: 'dup' });
        expect(first).toEqual({ id: first.id, name: 'dup' });

        // `tags.name` is unique — the second create must reject.
        await expect(tags.create({ name: 'dup' })).rejects.toThrow();

        const rows = await runtime.query<{ name: string }>('select name from tags order by name');
        expect(rows).toEqual([{ name: 'dup' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — writes scoped by relation filter (120–122)
  // ===========================================================================

  it(
    'entry 120: updateCount scoped by a relation filter updates only matching parents',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Popular', userId: 1, views: 150 },
          { id: 11, title: 'Quiet', userId: 2, views: 50 },
        ]);

        // Only user 1 owns a post with views >= 100.
        const count = await users
          .where((u) => u.posts.some((p) => p.views.gte(100)))
          .updateCount({ name: 'updated' });
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 1, name: 'updated' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Cara' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 121: deleteCount scoped by a relation filter deletes only matching parents',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 1 },
          { id: 11, title: 'B', userId: 2, views: 1 },
        ]);

        // Only Cara (id 3) owns no posts.
        const count = await users.where((u) => u.posts.none()).deleteCount();
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 122: deleteCount scoped by a two-level nested relation filter',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 1 },
          { id: 11, title: 'B', userId: 2, views: 1 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'veryBottom', postId: 10 },
          { id: 101, body: 'other', postId: 11 },
        ]);

        // Only Alice is reachable through posts → comments body 'veryBottom'.
        const count = await users
          .where((u) => u.posts.some((p) => p.comments.some((c) => c.body.eq('veryBottom'))))
          .deleteCount();
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 2, name: 'Bob' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — writes by unique selector (123–124)
  // ===========================================================================

  it(
    'entry 123: update scoped by a composite-PK selector',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = createReturningUserRolesCollection(runtime);

        await seedUserRoles(runtime, [
          { userId: 1, roleId: 'r1', level: 1 },
          { userId: 1, roleId: 'r2', level: 2 },
          { userId: 2, roleId: 'r1', level: 3 },
        ]);

        const updated = await userRoles
          .where({ userId: 1, roleId: asRoleId('r1') })
          .update({ level: 5 });
        expect(updated).toEqual({ userId: 1, roleId: 'r1', level: 5 });

        const rows = await runtime.query<{ user_id: number; role_id: string; level: number }>(
          'select user_id, role_id, level from user_roles order by user_id, role_id',
        );
        expect(rows).toEqual([
          { user_id: 1, role_id: 'r1', level: 5 },
          { user_id: 1, role_id: 'r2', level: 2 },
          { user_id: 2, role_id: 'r1', level: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 124: delete scoped by a composite-PK selector',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = createReturningUserRolesCollection(runtime);

        await seedUserRoles(runtime, [
          { userId: 1, roleId: 'r1', level: 1 },
          { userId: 2, roleId: 'r2', level: 2 },
        ]);

        const deleted = await userRoles.where({ userId: 1, roleId: asRoleId('r1') }).delete();
        expect(deleted).toEqual({ userId: 1, roleId: 'r1', level: 1 });

        const missing = await userRoles.where({ userId: 1, roleId: asRoleId('nope') }).delete();
        expect(missing).toBeNull();

        const rows = await runtime.query<{ user_id: number; role_id: string; level: number }>(
          'select user_id, role_id, level from user_roles order by user_id, role_id',
        );
        expect(rows).toEqual([{ user_id: 2, role_id: 'r2', level: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — unchecked (direct FK) writes (125–126)
  // ===========================================================================

  it(
    'entry 125: create writing an inlined relation FK scalar column directly',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        const created = await posts.create({ id: 1, title: 't', userId: 7, views: 0 });
        expect(created).toEqual({ id: 1, title: 't', userId: 7, views: 0, embedding: null });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts where id = $1',
          [1],
        );
        expect(rows).toEqual([{ id: 1, user_id: 7 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'entry 126: updateAll writing an FK scalar column directly',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'a', userId: 1, views: 5 },
          { id: 11, title: 'b', userId: 2, views: 6 },
          { id: 12, title: 'c', userId: 3, views: 7 },
        ]);

        const updated = await posts.where((p) => p.userId.neq(0)).updateAll({ userId: 9 });
        const sorted = [...updated].sort((a, b) => a.id - b.id);
        expect(sorted).toEqual([
          { id: 10, title: 'a', userId: 9, views: 5, embedding: null },
          { id: 11, title: 'b', userId: 9, views: 6, embedding: null },
          { id: 12, title: 'c', userId: 9, views: 7, embedding: null },
        ]);

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(rows).toEqual([
          { id: 10, user_id: 9 },
          { id: 11, user_id: 9 },
          { id: 12, user_id: 9 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Regressions — nested writes (127)
  // ===========================================================================

  it(
    'entry 127: nested connect of multiple existing children during update',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: null, views: 1 },
          { id: 11, title: 'Post B', userId: null, views: 2 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .update({
            posts: (posts) => posts.connect([{ id: 10 }, { id: 11 }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          posts: [
            { id: 10, title: 'Post A', userId: 1, views: 1, embedding: null },
            { id: 11, title: 'Post B', userId: 1, views: 2, embedding: null },
          ],
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(rows).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
