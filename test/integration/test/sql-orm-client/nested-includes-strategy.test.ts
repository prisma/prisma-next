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
import { timeouts, withCollectionRuntime } from './integration-helpers';
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
  // Dispatch carve-out for scalar / combine descriptors under the
  // lateral strategy: both shapes route through the single-query
  // builders at any depth. The recursive predicates
  // (`hasScalarIncludeDescriptors`, `hasCombineIncludeDescriptors`)
  // ensure a nested scalar / combine inside a row include doesn't
  // accidentally land on the planner throw. Under correlated, both
  // still fall back to multi-query — covered in the broader strategy
  // tests above.
  // ===========================================================================

  describe('dispatch carve-out for scalar / combine include descriptors', () => {
    it(
      'top-level combine() resolves in a single execution under lateral capabilities',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);

          // The lateral builder packs combine() into one LATERAL JOIN
          // whose inner SELECT cross-joins per-branch derived tables
          // and projects json_build_object over them. The whole tree
          // rolls up into a single SQL execution.
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

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: {
                items: [
                  { id: 10, title: 'A', userId: 1, views: 1, embedding: null },
                  { id: 11, title: 'B', userId: 1, views: 2, embedding: null },
                ],
                total: 2,
              },
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'nested scalar at depth 2 resolves in a single execution under lateral capabilities',
      async () => {
        // The recursive `hasScalarIncludeDescriptors` predicate matches
        // a scalar at any depth; the lateral builder then emits a
        // nested LATERAL inside the parent row's SELECT so the whole
        // tree resolves in one round-trip. This test pins that
        // recursion: a `count()` at depth 2 must roll up into the same
        // single-query plan as the outer row include.
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

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: [{ id: 10, title: 'A', userId: 1, views: 1, embedding: null, comments: 2 }],
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Sentinel coverage for the dispatch boundary: include trees with
  // `distinct()` on a non-leaf level must resolve via the single-query
  // strategies (lateral / correlated). A regression that flips dispatch
  // back to multi-query is caught here at the dispatch boundary, not
  // only downstream in the dedicated distinct suites.
  //
  // Result-shape coverage — hasMany/belongsTo grandchild variants, force-
  // included join keys, depth-3 trees, self-relations, refinements,
  // empty grandchildren — lives in:
  //   - test/integration/nested-includes-distinct.test.ts
  //   - test/integration/nested-includes-distinct-refinements.test.ts
  // ===========================================================================

  describe('non-leaf includes with distinct() resolve in a single SQL execution', () => {
    it(
      'distinct() on a non-leaf include resolves in 1 execution under lateral and correlated capabilities',
      async () => {
        // Both strategy variants share one `withCollectionRuntime` spinup
        // for the reason documented in `nested-includes-helpers.ts`.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const lateralUsers = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          await lateralUsers
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy((p) => p.title.asc())
                .include('comments'),
            )
            .orderBy((u) => u.id.asc())
            .all();
          expect(runtime.executions).toHaveLength(1);

          const correlatedUsers = collectionWithCapabilities(
            runtime,
            'User',
            CORRELATED_CAPABILITIES,
          );
          runtime.resetExecutions();
          await correlatedUsers
            .include('posts', (posts) =>
              posts.select('title').distinct('title').include('comments'),
            )
            .all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
