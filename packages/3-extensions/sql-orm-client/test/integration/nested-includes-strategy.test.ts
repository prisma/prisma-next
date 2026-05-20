// Integration coverage for nested includes (depth >= 2) across the
// three dispatch strategies: lateral, correlated, multi-query.
//
// Split from `nested-includes.test.ts` for the reason documented in
// `./nested-includes-helpers.ts` (per-file test-count threshold of the
// prisma/dev PGlite infrastructure).
//
// These tests are the heart of the TML-2594 acceptance: they pin the
// SQL-execution count per strategy, so a future regression flipping
// the dispatch gate is caught at the contract level, not by downstream
// benchmark drift. The cross-strategy equivalence tests then assert
// that the three strategies produce byte-identical result trees over
// the same data.

import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './helpers';
import {
  CORRELATED_CAPABILITIES,
  collectionWithCapabilities,
  LATERAL_CAPABILITIES,
  MULTI_QUERY_CAPABILITIES,
} from './nested-includes-helpers';
import { type PgIntegrationRuntime, seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe('integration/nested-includes/strategy', () => {
  // ===========================================================================
  // Cross-strategy correctness: the same query must yield byte-identical
  // result trees regardless of which dispatch strategy actually runs. This
  // is the strongest guarantee we offer downstream consumers.
  // ===========================================================================

  describe('cross-strategy result equivalence', () => {
    async function seedBlog(runtime: PgIntegrationRuntime) {
      await seedUsers(runtime, [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      await seedPosts(runtime, [
        { id: 10, title: 'A1', userId: 1, views: 1 },
        { id: 11, title: 'A2', userId: 1, views: 2 },
        { id: 12, title: 'B1', userId: 2, views: 3 },
      ]);
      await seedComments(runtime, [
        { id: 100, body: 'A1.c1', postId: 10 },
        { id: 101, body: 'A2.c1', postId: 11 },
        { id: 102, body: 'A2.c2', postId: 11 },
      ]);
    }

    const expectedRows = [
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        invitedById: null,
        address: null,
        posts: [
          {
            id: 10,
            title: 'A1',
            userId: 1,
            views: 1,
            embedding: null,
            comments: [{ id: 100, body: 'A1.c1', postId: 10 }],
          },
          {
            id: 11,
            title: 'A2',
            userId: 1,
            views: 2,
            embedding: null,
            comments: [
              { id: 101, body: 'A2.c1', postId: 11 },
              { id: 102, body: 'A2.c2', postId: 11 },
            ],
          },
        ],
      },
      {
        id: 2,
        name: 'Bob',
        email: 'bob@example.com',
        invitedById: null,
        address: null,
        posts: [
          {
            id: 12,
            title: 'B1',
            userId: 2,
            views: 3,
            embedding: null,
            comments: [],
          },
        ],
      },
    ];

    it(
      'depth-2 lateral path produces the canonical result tree',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedBlog(runtime);
          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('comments', (c) => c.orderBy((cc) => cc.id.asc())),
            )
            .all();
          expect(rows).toEqual(expectedRows);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 correlated path produces the canonical result tree',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedBlog(runtime);
          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('comments', (c) => c.orderBy((cc) => cc.id.asc())),
            )
            .all();
          expect(rows).toEqual(expectedRows);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 multi-query path produces the canonical result tree',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedBlog(runtime);
          const users = collectionWithCapabilities(runtime, 'User', MULTI_QUERY_CAPABILITIES);
          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('comments', (c) => c.orderBy((cc) => cc.id.asc())),
            )
            .all();
          expect(rows).toEqual(expectedRows);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // SQL execution counts per strategy. These are the TML-2594 acceptance
  // criteria. They fail under the pre-fix dispatch gate (which always
  // routes depth-2+ through multi-query) and pass once strategy selection
  // is honoured.
  // ===========================================================================

  describe('SQL execution count per strategy', () => {
    it(
      'depth-2 under lateral capabilities runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A1', userId: 1, views: 1 },
            { id: 11, title: 'B1', userId: 2, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('posts', (posts) => posts.include('comments')).all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 under correlated capabilities runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A1', userId: 1, views: 1 },
            { id: 11, title: 'B1', userId: 2, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('posts', (posts) => posts.include('comments')).all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 under empty capabilities runs 3 SQL executions (multi-query fallback)',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A1', userId: 1, views: 1 },
            { id: 11, title: 'B1', userId: 2, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', MULTI_QUERY_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('posts', (posts) => posts.include('comments')).all();
          // 1 parent + 1 IN-batched posts + 1 IN-batched comments = 3.
          // Independent of row count.
          expect(runtime.executions).toHaveLength(3);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-3 under lateral capabilities runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [{ id: 10, title: 'P', userId: 2, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          await users
            .include('invitedUsers', (inv) =>
              inv.include('posts', (posts) => posts.include('comments')),
            )
            .all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-3 under correlated capabilities runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [{ id: 10, title: 'P', userId: 2, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users
            .include('invitedUsers', (inv) =>
              inv.include('posts', (posts) => posts.include('comments')),
            )
            .all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-3 under empty capabilities runs 4 SQL executions (multi-query fallback)',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [{ id: 10, title: 'P', userId: 2, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', MULTI_QUERY_CAPABILITIES);
          runtime.resetExecutions();
          await users
            .include('invitedUsers', (inv) =>
              inv.include('posts', (posts) => posts.include('comments')),
            )
            .all();
          // parent + invitedUsers + posts + comments = 4.
          expect(runtime.executions).toHaveLength(4);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 self-relation under lateral capabilities runs a single SQL execution',
      async () => {
        // Self-relation aliasing must propagate through the recursion or
        // the lateral join will fail to compile against the same physical
        // table at two depths. Asserting one execution here pins both
        // the alias propagation and the strategy selection.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
            { id: 3, name: 'Grandchild', email: 'gc@example.com', invitedById: 2 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('invitedUsers', (inv) => inv.include('invitedUsers')).all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 self-relation under correlated capabilities runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
            { id: 3, name: 'Grandchild', email: 'gc@example.com', invitedById: 2 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('invitedUsers', (inv) => inv.include('invitedUsers')).all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Coexistence with the sibling TML-2595 gate. After TML-2594 drops the
  // `hasNestedIncludes` early-return, the dispatch must still route any
  // tree carrying a scalar or `combine()` descriptor through multi-query
  // (the lateral / correlated builders explicitly throw on those
  // descriptors). `hasComplexIncludeDescriptors` is recursive, so a
  // nested scalar at depth 2 also gates the dispatch — catching the
  // case where a future refactor might assume only top-level scalars
  // need the gate.
  // ===========================================================================

  describe('coexistence with TML-2595 (scalar/combine still on multi-query)', () => {
    it(
      'top-level combine() stays on multi-query under lateral capabilities',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);

          // `combine()` at the top of an include must continue to route
          // through multi-query until TML-2595 lands. Asserting > 1
          // execution gives a forward-compatible upper bound: when
          // TML-2595 collapses this to one round-trip we'll flip this
          // from `.toBeGreaterThan(1)` to `.toBe(1)`.
          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (p) =>
              p.combine({
                items: p.orderBy((pp) => pp.id.asc()),
                total: p.count(),
              }),
            )
            .all();

          expect(rows[0]?.posts.total).toBe(2);
          expect(rows[0]?.posts.items).toHaveLength(2);
          expect(runtime.executions.length).toBeGreaterThan(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'nested scalar at depth 2 stays on multi-query under lateral capabilities (recursive gate)',
      async () => {
        // The fix in TML-2594 dropped the shallow `hasNestedIncludes`
        // gate but tightened `hasComplexIncludeDescriptors` to recurse.
        // This test pins that recursion: a `count()` at depth 2 must
        // still gate the whole tree to multi-query, even though the
        // outer include is row-shaped (which the lateral builder
        // otherwise handles).
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'A', userId: 1, views: 1 }]);
          await seedComments(runtime, [
            { id: 100, body: 'c1', postId: 10 },
            { id: 101, body: 'c2', postId: 10 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) => posts.include('comments', (c) => c.count()))
            .all();

          expect(rows[0]?.posts[0]?.comments).toBe(2);
          expect(runtime.executions.length).toBeGreaterThan(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
