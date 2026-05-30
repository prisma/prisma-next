// Integration coverage for nested includes (depth >= 2) across both
// single-query dispatch strategies: lateral and correlated.
//
// Split from `nested-includes.test.ts` for the reason documented in
// `./nested-includes-helpers.ts` (per-file test-count threshold of the
// prisma/dev PGlite infrastructure).
//
// These tests pin the SQL-execution count per strategy, so a future
// regression flipping the dispatch gate is caught at the contract
// level, not by downstream benchmark drift. The cross-strategy
// equivalence tests then assert that both single-query strategies —
// lateral and correlated — produce byte-identical result trees over
// the same data.

import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import {
  CORRELATED_CAPABILITIES,
  collectionWithCapabilities,
  LATERAL_CAPABILITIES,
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
  // Scalar / combine include descriptors resolve in a single SQL
  // execution under both lateral and correlated capabilities. The
  // single-query builders lower scalar and combine at any depth; the
  // dispatch path no longer has a descriptor-aware fallback to
  // multi-query.
  // ===========================================================================

  describe('scalar / combine include descriptors resolve in a single execution', () => {
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
        // The lateral builder emits a nested LATERAL inside the parent
        // row's SELECT so the whole tree resolves in one round-trip.
        // This test pins that recursion: a `count()` at depth 2 must
        // roll up into the same single-query plan as the outer row
        // include.
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

    // Correlated mirror of the lateral scalar count test. Same shape,
    // same result; the SQL primitive is a correlated subquery instead
    // of a LATERAL JOIN. Both paths produce one execution.
    it(
      'scalar count() resolves in a single execution under correlated capabilities',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
            { id: 12, title: 'C', userId: 2, views: 3 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) => posts.count())
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: 2,
            },
            {
              id: 2,
              name: 'Bob',
              email: 'bob@example.com',
              invitedById: null,
              address: null,
              posts: 1,
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Correlated mirror: `take(N)` on a count() refine composes
    // through to the aggregate scope, same as the lateral path.
    it(
      'pagination composes through to scalar aggregate scope under correlated',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 100 },
            { id: 11, title: 'B', userId: 1, views: 200 },
            { id: 12, title: 'C', userId: 1, views: 300 },
            { id: 13, title: 'D', userId: 1, views: 400 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) =>
              posts
                .where((p) => p.views.gte(200))
                .take(2)
                .count(),
            )
            .all();

          // Three posts match views >= 200; take(2) caps the row set
          // the aggregate sees — count = 2.
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: 2,
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Correlated mirror of the lateral `distinct(cols).orderBy().take().sum()`
    // integration test. The fix in `buildIncludeChildScalarSelect`
    // reapplies orderBy after the ROW_NUMBER dedup wrap for both
    // strategies; this pins the correlated path produces the same
    // ordered-top-N sum (700) rather than an insertion-order slice.
    it(
      'distinct(cols).orderBy().take().sum() aggregates the ordered top-N deduped rows under correlated',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 100 },
            { id: 11, title: 'A', userId: 1, views: 200 },
            { id: 12, title: 'B', userId: 1, views: 50 },
            { id: 13, title: 'B', userId: 1, views: 300 },
            { id: 14, title: 'C', userId: 1, views: 400 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) =>
              posts
                .distinct('title')
                .orderBy((post) => post.views.desc())
                .take(2)
                .sum('views'),
            )
            .all();

          // Deduped reps: views = [200, 300, 400]; ordered top 2 = [400, 300]; sum = 700.
          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: 700,
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Combine under correlated: same Pothos `totalCount` worked
    // example as the lateral version, validated against the correlated
    // emission shape (one correlated subquery whose FROM cross-joins
    // per-branch derived tables).
    it(
      'combine({ rows, count }) resolves in a single execution under correlated capabilities',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
            { id: 12, title: 'C', userId: 1, views: 3 },
            { id: 13, title: 'D', userId: 1, views: 4 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) =>
              posts.combine({
                recent: posts.orderBy((p) => p.id.desc()).take(2),
                total: posts.count(),
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
                recent: [
                  { id: 13, title: 'D', userId: 1, views: 4, embedding: null },
                  { id: 12, title: 'C', userId: 1, views: 3, embedding: null },
                ],
                total: 4,
              },
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
