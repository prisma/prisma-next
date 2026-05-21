// Integration coverage for `distinct()` on a non-leaf include under the
// single-query strategies (lateral, correlated).
//
// Linear: TML-2656.
//
// History: prior to this slice, `include('rel', r => r.distinct().include('grandchild'))`
// unconditionally fell through `hasNonLeafIncludeWithDistinct` in
// `dispatchWithIncludeStrategy()` and was routed to multi-query. The underlying
// constraint was semantic, not a code defect — the single-query lowering would
// emit `SELECT DISTINCT <scalars>, json_agg(<grandchild>) FROM ...` inside the
// LATERAL / correlated child SELECT, and Postgres rejects equality on the
// `json` aggregate column.
//
// The post-fix lowering uses a CTE / wrapped-subquery shape: pre-aggregate
// distinct scalar children first (force-including the grandchild join keys),
// then attach grandchild aggregates onto the deduped rows. `DISTINCT` runs
// over scalar columns only — no `json` column is in scope — and grandchild
// aggregates compute after the dedupe. This mirrors the multi-query
// stitcher's "dedupe scalar rows before joining nested aggregates" in pure
// SQL.
//
// These tests focus on the lateral/subquery side, per the project plan: the
// multi-query include strategy is being removed in a follow-up PR. Each test
// asserts both `runtime.executions.length === 1` (single execution) and the
// full row tree (`expect(rows).toEqual([...])`) under explicit `.select(...)`
// projections so the shapes are stable.
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
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 10 },
            { id: 102, body: 'b1', postId: 11 },
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
                .orderBy((p) => p.title.asc())
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
                  title: 'B',
                  comments: [{ id: 102, body: 'b1' }],
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
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 10 },
            { id: 102, body: 'b1', postId: 11 },
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
                .orderBy((p) => p.title.asc())
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
                  title: 'B',
                  comments: [{ id: 102, body: 'b1' }],
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
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 2, views: 2 },
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
                .orderBy((p) => p.title.asc())
                .include('author', (a) => a.select('id', 'name')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              posts: [{ id: 10, title: 'A', author: { id: 1, name: 'Alice' } }],
            },
            {
              id: 2,
              name: 'Bob',
              posts: [{ id: 11, title: 'B', author: { id: 2, name: 'Bob' } }],
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
            { id: 11, title: 'B', userId: 2, views: 2 },
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
                .orderBy((p) => p.title.asc())
                .include('author', (a) => a.select('id', 'name')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              posts: [{ id: 10, title: 'A', author: { id: 1, name: 'Alice' } }],
            },
            {
              id: 2,
              name: 'Bob',
              posts: [{ id: 11, title: 'B', author: { id: 2, name: 'Bob' } }],
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
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'b1', postId: 11 },
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
                .orderBy((p) => p.title.asc())
                .include('comments', (c) => c.select('body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { title: 'A', comments: [{ body: 'a1' }] },
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
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'b1', postId: 11 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy((p) => p.title.asc())
                .include('comments', (c) => c.select('body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { title: 'A', comments: [{ body: 'a1' }] },
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
            { id: 11, title: 'B', userId: 2, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'b1', postId: 11 },
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
                    .orderBy((p) => p.title.asc())
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
                    { id: 11, title: 'B', comments: [{ body: 'b1' }] },
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
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'A', email: 'a@example.com', invitedById: 1 },
            { id: 3, name: 'B', email: 'b@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'aP', userId: 2, views: 1 },
            { id: 11, title: 'bP', userId: 3, views: 2 },
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
                .orderBy((u) => u.name.asc())
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
                { id: 3, name: 'B', posts: [{ title: 'bP' }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
