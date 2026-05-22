// Integration coverage for `distinct()` on a non-leaf include under the
// single-query strategies (lateral, correlated).
//
// Each test asserts both `runtime.executions.length === 1` (single execution)
// and the full row tree (`expect(rows).toEqual([...])`) under explicit
// `.select(...)` projections so the shapes are stable.
//
// Refinements (`orderBy` / `take` / `where` / multi-column distinct) and
// edge cases (empty grandchildren, zero surviving distinct rows) live in
// `./nested-includes-distinct-refinements.test.ts` to stay under the
// per-file test-count threshold documented in `./nested-includes-helpers.ts`.

import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './helpers';
import {
  CORRELATED_CAPABILITIES,
  collectionWithCapabilities,
  LATERAL_CAPABILITIES,
} from './nested-includes-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe('integration/nested-includes/distinct', () => {
  // ===========================================================================
  // Single execution + canonical shape under both single-query capabilities.
  // Each variant exercises the post-CTE lowering for the most common shapes:
  // hasMany non-leaf + hasMany leaf, hasMany non-leaf + belongsTo leaf.
  // ===========================================================================

  describe('single execution under single-query capabilities', () => {
    it(
      'lateral: depth-2 hasMany + hasMany leaf — single execution + canonical shape',
      async () => {
        // Seed two posts sharing the title 'A' so the distinct path actually
        // sees colliding distinct-column values. Per spec D3, dedupe is a
        // structural no-op once grandchild join keys (here `post.id`) are
        // force-included into the inner projection — the wrapped subquery's
        // user-visible output stays bit-for-bit equivalent to the multi-query
        // stitcher, which means both 'A' rows survive and each stitches its
        // own grandchildren.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 1, views: 3 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 10 },
            { id: 102, body: 'a3', postId: 11 },
            { id: 103, body: 'b1', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .select('id', 'title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('id', 'body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                {
                  id: 10,
                  title: 'A',
                  comments: [
                    { id: 100, body: 'a1' },
                    { id: 101, body: 'a2' },
                  ],
                },
                {
                  id: 11,
                  title: 'A',
                  comments: [{ id: 102, body: 'a3' }],
                },
                {
                  id: 12,
                  title: 'B',
                  comments: [{ id: 103, body: 'b1' }],
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'correlated: depth-2 hasMany + hasMany leaf — single execution + canonical shape',
      async () => {
        // Same setup as the lateral variant; only capabilities differ. The
        // correlated builder reaches into the same `buildIncludeChildRowsSelect`
        // helper, so the wrapped-subquery shape must be uniform between
        // the two strategies.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 1, views: 3 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 10 },
            { id: 102, body: 'a3', postId: 11 },
            { id: 103, body: 'b1', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .select('id', 'title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('id', 'body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                {
                  id: 10,
                  title: 'A',
                  comments: [
                    { id: 100, body: 'a1' },
                    { id: 101, body: 'a2' },
                  ],
                },
                {
                  id: 11,
                  title: 'A',
                  comments: [{ id: 102, body: 'a3' }],
                },
                {
                  id: 12,
                  title: 'B',
                  comments: [{ id: 103, body: 'b1' }],
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'lateral: depth-2 hasMany + belongsTo leaf — single execution + canonical shape',
      async () => {
        // Mixed cardinality at the leaf: the depth-2 grandchild is a
        // to-one belongsTo (post.author), which collapses to a single
        // object rather than an array. The wrapper subquery projects the
        // distinct post scalars + the join key for `author` (post.user_id),
        // and the author subquery joins against that key.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          // Two of Alice's posts share the title 'A' so the distinct path
          // sees colliding distinct-column values (see spec D3).
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 2, views: 3 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('id', 'name')
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .select('id', 'title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('author', (a) => a.select('id', 'name')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              posts: [
                { id: 10, title: 'A', author: { id: 1, name: 'Alice' } },
                { id: 11, title: 'A', author: { id: 1, name: 'Alice' } },
              ],
            },
            {
              id: 2,
              name: 'Bob',
              posts: [{ id: 12, title: 'B', author: { id: 2, name: 'Bob' } }],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'correlated: depth-2 hasMany + belongsTo leaf — single execution + canonical shape',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 2, views: 3 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('id', 'name')
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .select('id', 'title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('author', (a) => a.select('id', 'name')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              posts: [
                { id: 10, title: 'A', author: { id: 1, name: 'Alice' } },
                { id: 11, title: 'A', author: { id: 1, name: 'Alice' } },
              ],
            },
            {
              id: 2,
              name: 'Bob',
              posts: [{ id: 12, title: 'B', author: { id: 2, name: 'Bob' } }],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Force-include of grandchild join keys.
  //
  // When the user `.select(...)`'s on the distinct level excludes the
  // grandchild's `localColumn` (post.id for the comments include), the
  // wrapper subquery must still pull that column into its projection so
  // the grandchild correlated subquery can find its parent. The column
  // is then stripped from the user-visible row shape.
  //
  // Mirror of `augmentSelectionForJoinColumns` + `stripHiddenMappedFields`
  // in the multi-query stitcher; if the new lowering forgets the force-
  // include, the grandchild arrays come back empty (or the SQL fails at
  // lower-time because the join key is unresolved).
  // ===========================================================================

  describe('force-include of grandchild join keys', () => {
    it(
      'lateral: select() omitting post.id still stitches comments under distinct',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          // Two posts share the title 'A' — each surviving row still stitches
          // its own grandchildren (id is hidden from the user-visible shape
          // but force-included for the comments correlated subquery).
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 1, views: 3 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 11 },
            { id: 102, body: 'b1', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          // `.select('title')` on posts omits post.id, but the grandchild
          // `comments` include needs post.id for stitching. The wrapper
          // must force-include it and strip it from the visible row.
          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { title: 'A', comments: [{ body: 'a1' }] },
                { title: 'A', comments: [{ body: 'a2' }] },
                { title: 'B', comments: [{ body: 'b1' }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'correlated: select() omitting post.id still stitches comments under distinct',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 1, views: 3 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 11 },
            { id: 102, body: 'b1', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { title: 'A', comments: [{ body: 'a1' }] },
                { title: 'A', comments: [{ body: 'a2' }] },
                { title: 'B', comments: [{ body: 'b1' }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Nested distinct shapes. `distinct()` can sit at any non-leaf level in
  // the include tree; the wrapped-subquery lowering recurses uniformly.
  // ===========================================================================

  describe('nested distinct shapes', () => {
    it(
      'distinct at depth 2 (nested under a depth-1 row include) — single execution + shape',
      async () => {
        // Depth-3 tree, with `distinct()` on the depth-2 level rather than
        // depth 1. The wrapped-subquery shape must compose recursively: the
        // outer lateral / correlated builder reaches into the inner one,
        // which builds its own distinct wrapper with its own grandchild
        // join keys.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 2, views: 1 },
            { id: 11, title: 'A', userId: 2, views: 2 },
            { id: 12, title: 'B', userId: 2, views: 3 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 11 },
            { id: 102, body: 'b1', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('id', 'name')
            .orderBy((u) => u.id.asc())
            .include('invitedUsers', (inv) =>
              inv
                .select('id', 'name')
                .orderBy((u) => u.id.asc())
                .include('posts', (posts) =>
                  posts
                    .select('id', 'title')
                    .distinct('title')
                    .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                    .include('comments', (c) => c.select('body')),
                ),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Root',
              invitedUsers: [
                {
                  id: 2,
                  name: 'Child',
                  posts: [
                    { id: 10, title: 'A', comments: [{ body: 'a1' }] },
                    { id: 11, title: 'A', comments: [{ body: 'a2' }] },
                    { id: 12, title: 'B', comments: [{ body: 'b1' }] },
                  ],
                },
              ],
            },
            {
              id: 2,
              name: 'Child',
              invitedUsers: [],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct on a self-relation non-leaf — single execution + shape',
      async () => {
        // Self-relation aliasing must propagate through the recursion or
        // the distinct wrapper will reference the wrong physical table at
        // depth 2. Asserting one execution pins both the alias
        // propagation and the new wrapped-subquery shape.
        await withCollectionRuntime(async (runtime) => {
          // Two invitees share the name 'A' so the distinct path sees
          // colliding distinct-column values.
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'A', email: 'a@example.com', invitedById: 1 },
            { id: 3, name: 'A', email: 'a2@example.com', invitedById: 1 },
            { id: 4, name: 'B', email: 'b@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'aP', userId: 2, views: 1 },
            { id: 11, title: 'a2P', userId: 3, views: 2 },
            { id: 12, title: 'bP', userId: 4, views: 3 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('id', 'name')
            .where((u) => u.id.eq(1))
            .include('invitedUsers', (inv) =>
              inv
                .select('id', 'name')
                .distinct('name')
                .orderBy([(u) => u.name.asc(), (u) => u.id.asc()])
                .include('posts', (p) => p.select('title').orderBy((pp) => pp.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Root',
              invitedUsers: [
                { id: 2, name: 'A', posts: [{ title: 'aP' }] },
                { id: 3, name: 'A', posts: [{ title: 'a2P' }] },
                { id: 4, name: 'B', posts: [{ title: 'bP' }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct at depth 1 inside a depth-3 tree — single execution + shape',
      async () => {
        // The load-bearing recursion case for the distinct wrapper: the
        // depth-1 include is distinct AND has nested grandchildren that
        // themselves carry a further include. The wrapper must force-
        // project the grandchild join key into the distinct inner select
        // while the recursive child of that grandchild correlates back
        // through the distinct alias. Companion to the depth-2 distinct
        // case above; together they pin the recursion at both endpoints.
        await withCollectionRuntime(async (runtime) => {
          // Two invitees share the name 'A' so the distinct path sees
          // colliding distinct-column values; each surviving row still
          // recurses into its own posts → comments grandchildren.
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'A', email: 'a@example.com', invitedById: 1 },
            { id: 3, name: 'A', email: 'a2@example.com', invitedById: 1 },
            { id: 4, name: 'B', email: 'b@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'aP', userId: 2, views: 1 },
            { id: 11, title: 'a2P', userId: 3, views: 2 },
            { id: 12, title: 'bP', userId: 4, views: 3 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'aC', postId: 10 },
            { id: 101, body: 'a2C', postId: 11 },
            { id: 102, body: 'bC', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('id', 'name')
            .where((u) => u.id.eq(1))
            .include('invitedUsers', (invitedUsers) =>
              invitedUsers
                .select('name')
                .distinct('name')
                .orderBy([(u) => u.name.asc(), (u) => u.id.asc()])
                .include('posts', (posts) =>
                  posts
                    .select('title')
                    .orderBy((p) => p.id.asc())
                    .include('comments', (c) => c.select('body').orderBy((cc) => cc.id.asc())),
                ),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Root',
              invitedUsers: [
                { name: 'A', posts: [{ title: 'aP', comments: [{ body: 'aC' }] }] },
                { name: 'A', posts: [{ title: 'a2P', comments: [{ body: 'a2C' }] }] },
                { name: 'B', posts: [{ title: 'bP', comments: [{ body: 'bC' }] }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct non-leaf with two sibling grandchildren sharing the same join column',
      async () => {
        // Regression for the duplicate-forced-join-key failure mode: when
        // two sibling nested includes both join from the same `localColumn`
        // on the distinct child (here, `invitedUsers` and `posts` both
        // join from `users.id`), the wrapper's force-include must collapse
        // the duplicate before projection. Without the `new Set` collapse,
        // the inner derived table would project `id` twice and the
        // outer `distinctAlias.id` reference would be ambiguous — the
        // query either fails at lower-time or silently returns wrong data.
        await withCollectionRuntime(async (runtime) => {
          // Two depth-1 invitees share the name 'A' so the distinct path
          // sees colliding distinct-column values; each surviving row must
          // still stitch its own `invitedUsers` + `posts` grandchildren via
          // the shared `users.id` join key.
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'A', email: 'a@example.com', invitedById: 1 },
            { id: 3, name: 'A', email: 'a2@example.com', invitedById: 1 },
            { id: 4, name: 'B', email: 'b@example.com', invitedById: 1 },
            { id: 5, name: 'GC', email: 'gc@example.com', invitedById: 2 },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'aP', userId: 2, views: 1 },
            { id: 11, title: 'a2P', userId: 3, views: 2 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          // `.select('name')` drops `id` from the user-visible projection.
          // Both grandchild includes (`invitedUsers`, `posts`) need
          // `users.id` to correlate — same `localColumn`. Without the
          // dedupe, the wrapper widens the projection with a duplicate
          // `id` alias.
          const rows = await users
            .select('id', 'name')
            .where((u) => u.id.eq(1))
            .include('invitedUsers', (invitedUsers) =>
              invitedUsers
                .select('name')
                .distinct('name')
                .orderBy([(u) => u.name.asc(), (u) => u.id.asc()])
                .include('invitedUsers', (gc) => gc.select('name'))
                .include('posts', (p) => p.select('title').orderBy((pp) => pp.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Root',
              invitedUsers: [
                { name: 'A', invitedUsers: [{ name: 'GC' }], posts: [{ title: 'aP' }] },
                { name: 'A', invitedUsers: [], posts: [{ title: 'a2P' }] },
                { name: 'B', invitedUsers: [], posts: [] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
