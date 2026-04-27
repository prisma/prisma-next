/**
 * Integration tests pinning the H2 and H3 invariants.
 *
 * These assert the observable concurrency behavior of
 * `RuntimeCoreImpl.verifyPlanIfNeeded()` under the exact configuration
 * the RSC app stresses: one shared runtime, K parallel queries on the
 * Node event loop.
 *
 * ## What we pin
 *
 * - **H2 cold-start behavior** (`onFirstUse` / `startup` modes): on the
 *   first concurrent burst of K queries against a cold runtime, marker
 *   reads can be up to K — each concurrent caller may race through
 *   `verifyPlanIfNeeded` before any of them flips `verified = true`.
 *   After the first burst settles, subsequent queries issue zero
 *   marker reads.
 *
 * - **H3 always-mode invariant**: with `verify.mode === 'always'`,
 *   every query unconditionally verifies, so for K parallel queries the
 *   marker-read delta equals K regardless of concurrency. The original
 *   H3 claim (a race skipping verification) doesn't survive a
 *   source-level re-read of `verifyPlanIfNeeded`; see `plan.md §2` for
 *   the reasoning. This test locks in the corrected expectation as a
 *   regression guard.
 *
 * - **Balance invariant** (both modes): every successful pool acquire
 *   is matched by exactly one release. Counted by `InstrumentedPool`
 *   via `pg-pool`'s `'release'` event plus a post-`super.connect()`
 *   counter bump — see `src/lib/pool.ts` for why those specific
 *   observation points (prior revisions were lossy).
 *
 * ## Test level: process, not HTTP
 *
 * The invariants live in the runtime, not in RSC. We fire queries
 * directly against a shared `@prisma-next/postgres` client and skip
 * the Next.js layer entirely. On the event loop, this is identical to
 * what the `<TopUsers />` etc. components produce during concurrent
 * rendering, but without the orchestration tax of `next start`,
 * ports, and HTTP debugging.
 *
 * HTTP-level coverage lives in the k6 scripts: `stress:spike` hits
 * `/stress/always` and the teardown-time `/diag` delta is the
 * end-to-end observation. This file is the deterministic pin.
 *
 * ## Why this test requires a real Postgres (not ppg-dev)
 *
 * `@prisma/dev` (ppg-dev, used by `withDevDatabase`) is a PGlite-backed
 * single-connection server: it accepts one TCP connection at a time
 * and rejects concurrent attempts with "Connection terminated
 * unexpectedly". That's fine for `prisma-next-demo`'s sequential
 * integration tests, but these H2/H3 tests are specifically about
 * **concurrent** connection borrowing — the race window only exists
 * when multiple `verifyPlanIfNeeded` calls are actually in flight
 * simultaneously.
 *
 * So we require `DATABASE_URL` to point at a Postgres (with pgvector)
 * that accepts multiple concurrent connections. When it's unset, the
 * whole suite is `describe.skip`'d with a clear message. Running it
 * locally:
 *
 *     # in one shell (from repo root):
 *     docker run --rm -d --name rsc-poc-pg -p 5434:5432 \
 *       -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rsc_poc \
 *       pgvector/pgvector:pg17
 *
 *     # then:
 *     DATABASE_URL=postgresql://postgres:postgres@localhost:5434/rsc_poc \
 *       pnpm --filter rsc-poc-postgres test
 *
 * CI skips these tests. The H3 invariant is simple enough that the
 * source-level reasoning in `plan.md §2` is the primary argument; this
 * test exists to pin it against future regressions and is most useful
 * run by a developer against a real database during local dev.
 *
 * ## Isolation strategy: drop-and-recreate `public` before each test
 *
 * We **do not** use per-test scratch schemas. That approach fights the
 * contract/adapter: the generated DDL hardcodes `"public"."user"` and
 * `"public"."post"`, and the pgvector extension gets installed in
 * `public` too, so setting `search_path` on the connection URL does
 * not actually redirect writes — it only affects unqualified reads.
 *
 * Instead, each test drops and recreates the `public` schema (and the
 * `prisma_contract` schema that `dbInit` writes its marker into),
 * then re-applies the contract. This is the same approach the app's
 * own `scripts/drop-db.ts` uses. Vitest is configured with
 * `maxWorkers: 1` in `vitest.config.ts`, so these mutations serialize
 * naturally — no locking needed.
 *
 * Trade-off: a second `pnpm test` invocation running on the same
 * `DATABASE_URL` concurrently would corrupt the shared database.
 * Don't do that. If you need isolated concurrent runs, point each at
 * its own Postgres instance.
 *
 * ## Why each test builds its own runtime
 *
 * - Each test needs to observe cold-start behavior for at least one
 *   phase of its assertions, so we can't share a warmed-up runtime
 *   across tests.
 * - The app's `src/lib/db.ts` pins runtimes to `globalThis` keyed by
 *   `(verifyMode, poolMax)`. Tests bypass that registry to avoid
 *   bleed-through from a previous test's state.
 */

import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres, { type PostgresClient } from '@prisma-next/postgres/runtime';
import { timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import type { VerifyMode } from '../src/lib/db';
import { reset, snapshot } from '../src/lib/diag';
import { InstrumentedPool } from '../src/lib/pool';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { initTestDatabase } from './utils/control-client';

const DATABASE_URL = process.env['DATABASE_URL'];

interface TestRuntime {
  readonly client: PostgresClient<Contract>;
  readonly pool: InstrumentedPool;
  readonly verifyMode: VerifyMode;
  close(): Promise<void>;
}

/**
 * Drops and recreates the `public` schema and drops the
 * `prisma_contract` schema so a subsequent `initTestDatabase` starts
 * from a clean slate. Matches `scripts/drop-db.ts` in the app.
 */
async function resetDatabase(baseUrl: string): Promise<void> {
  const client = new Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
  } finally {
    await client.end();
  }
}

async function createTestRuntime(
  connectionString: string,
  verifyMode: VerifyMode,
  poolMax = 10,
): Promise<TestRuntime> {
  const pool = new InstrumentedPool({
    connectionString,
    max: poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    verifyMode,
  });

  const client = postgres<Contract>({
    contractJson,
    pg: pool,
    extensions: [pgvector],
    verify: { mode: verifyMode, requireMarker: false },
  });

  await client.connect();

  return {
    client,
    pool,
    verifyMode,
    async close() {
      // `postgres()` doesn't expose a top-level close; ending the pool we
      // passed in cleans up every pg client the runtime ever borrowed.
      await pool.end();
    },
  };
}

/**
 * Exercises the same ORM path the five Server Components use, so the
 * invariant test covers the production shape — not a simplified
 * query that might bypass `acquireRuntimeScope()` or
 * `verifyPlanIfNeeded()`.
 */
async function runOneOrmQuery(rt: TestRuntime): Promise<void> {
  await rt.client.orm.User.take(1).all();
}

async function runKParallelQueries(rt: TestRuntime, k: number): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  for (let i = 0; i < k; i++) {
    tasks.push(runOneOrmQuery(rt));
  }
  await Promise.all(tasks);
}

async function withFreshRuntime(
  verifyMode: VerifyMode,
  fn: (rt: TestRuntime) => Promise<void>,
  poolMax?: number,
): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error('withFreshRuntime called without DATABASE_URL — describe.skipIf should guard');
  }
  await resetDatabase(DATABASE_URL);
  await initTestDatabase({ connection: DATABASE_URL, contract: contractJson });
  const rt = await createTestRuntime(DATABASE_URL, verifyMode, poolMax);
  try {
    await fn(rt);
  } finally {
    await rt.close();
  }
}

describe.skipIf(!DATABASE_URL)(
  'verifyPlanIfNeeded invariants under concurrency',
  { timeout: timeouts.spinUpPpgDev },
  () => {
    afterEach(() => {
      // Counters are `globalThis`-backed; clear between tests so one
      // test's acquires don't bleed into another's delta.
      reset();
    });

    describe('H2 — onFirstUse cold-start behavior', () => {
      it('K concurrent queries on a cold runtime issue up to K marker reads; 0 thereafter', async () => {
        await withFreshRuntime('onFirstUse', async (rt) => {
          const K = 5;

          // First burst — this is the race window H2 predicts.
          await runKParallelQueries(rt, K);
          const coldSnap = snapshot('onFirstUse');

          // H2: up to K marker reads on the first burst. At least 1
          // (contract verification must happen), at most K (every
          // caller raced through the verify check before the first
          // one flipped `verified = true`).
          expect(coldSnap.markerReads).toBeGreaterThanOrEqual(1);
          expect(coldSnap.markerReads).toBeLessThanOrEqual(K);

          // Every acquire from the burst is released.
          expect(coldSnap.connectionAcquires).toBe(coldSnap.connectionReleases);

          // Second burst — `verified` is now true, so no new marker
          // reads should happen regardless of concurrency.
          await runKParallelQueries(rt, K);
          const warmSnap = snapshot('onFirstUse');

          expect(warmSnap.markerReads).toBe(coldSnap.markerReads);
          expect(warmSnap.connectionAcquires).toBe(warmSnap.connectionReleases);
          expect(warmSnap.connectionAcquires).toBeGreaterThan(coldSnap.connectionAcquires);
        });
      });

      it('a single cold query issues exactly 1 marker read', async () => {
        await withFreshRuntime('onFirstUse', async (rt) => {
          await runOneOrmQuery(rt);
          const snap = snapshot('onFirstUse');

          // Single-query sanity: with no concurrent peers the race
          // window is empty, so exactly one marker read happens.
          // Pinning this prevents a regression where the runtime
          // would silently start doing 2+ marker reads per query.
          expect(snap.markerReads).toBe(1);
          expect(snap.connectionAcquires).toBe(snap.connectionReleases);
        });
      });
    });

    describe('H3 — always-mode invariant', () => {
      it.each([
        { name: 'K=1 (single query)', k: 1 },
        { name: 'K=5 (matches the RSC page shape)', k: 5 },
        { name: 'K=50 (well past the default pool max)', k: 50 },
      ])('markerReads delta equals queryCount: $name', async ({ k }) => {
        await withFreshRuntime('always', async (rt) => {
          await runKParallelQueries(rt, k);
          const snap = snapshot('always');

          // H3 (revised): every `execute()` in `always` mode runs
          // through `verifyPlanIfNeeded` because lines (verified =
          // false) and (if (verified) return) are synchronous
          // neighbors — the early-return is unreachable in
          // always-mode. Hence markerReads === queryCount,
          // regardless of concurrency.
          expect(snap.markerReads).toBe(k);

          // Balance invariant: every successful pool.connect()
          // resolves to a matching pool release. Desync here would
          // indicate either (a) an instrumentation bug (the prior
          // revision counted acquires before connect() resolved —
          // see src/lib/pool.ts) or (b) a real connection leak in
          // the runtime.
          expect(snap.connectionAcquires).toBe(snap.connectionReleases);
          expect(snap.connectionAcquires).toBeGreaterThanOrEqual(k);
        });
      });

      it('repeated bursts keep issuing one marker read per query', async () => {
        await withFreshRuntime('always', async (rt) => {
          const K = 5;
          const BURSTS = 3;

          for (let i = 0; i < BURSTS; i++) {
            await runKParallelQueries(rt, K);
          }

          const snap = snapshot('always');

          // always mode never caches verification, so the invariant
          // holds cumulatively too — not just within a single burst.
          expect(snap.markerReads).toBe(K * BURSTS);
          expect(snap.connectionAcquires).toBe(snap.connectionReleases);
        });
      });
    });
  },
);
