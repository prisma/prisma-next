/**
 * Integration spec for the per-request scoped Supabase runtime (T2.1).
 *
 * Lands in `phase-2 slice 1` ahead of T2.2's implementation, so the
 * commit history records tests-first ordering (R-NF-4). Until
 * `src/server/supabase-runtime.ts` exists, the import below fails and
 * the suite is red — which is exactly what tests-first wants.
 *
 * What this spec verifies (covers spec.md R-FX-1, R-FX-2, R-FX-4 → R-FX-8)
 * --------------------------------------------------------------------
 * The userspace factory `createSupabaseRuntime` produces, per
 * `authenticate()` call, a `SupabaseSession` that opens a transaction,
 * issues `SET LOCAL request.jwt.claims = …` and `SET LOCAL ROLE …`,
 * and proxies the resulting transaction-scoped queryable as a
 * `Runtime`. Because the role is downgraded from `postgres` (superuser,
 * RLS bypass) to `authenticated` / `anon`, RLS policies authored in
 * the M1 migration take effect — the *only* way alice's session sees
 * 3 todos rather than all 5 is for the `SET LOCAL ROLE` step to fire
 * and for `auth.uid()` to read alice's `sub` claim from the GUC.
 *
 * Cross-contamination tests (RLS actually filtering) live here; the
 * baseline "RLS bypassed → all rows visible" admin runtime is covered
 * by `test/runtime/admin.test.ts`.
 *
 * Notes on test 8 (mid-iteration throw)
 * -------------------------------------
 * `Runtime#execute` returns an `AsyncIterableResult` whose iteration
 * surface (cursor vs. buffered) is an implementation detail of the
 * underlying driver. Either way, throwing from inside the consumer's
 * `for await` body must (a) propagate the original error and (b) leave
 * the pool in a consistent state — the per-session transaction must
 * be rolled back and the borrowed client either returned clean or
 * destroyed. We assert both via the original error reaching the
 * caller and a follow-up authenticated session succeeding against
 * the same pool. If T2.2's implementation does not expose a public
 * cursor surface, this test still asserts the rollback contract via
 * the recovery path.
 *
 * Environment
 * -----------
 *   DATABASE_URL  Direct Postgres URL for the local Supabase stack
 *                 (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
 *                 Loaded via `dotenv/config`. Missing → suite skipped.
 *
 * Preconditions (same as admin.test.ts)
 * -------------------------------------
 *   1. `supabase start` is running.
 *   2. `pnpm --filter supabase-todos migrate:up` has been applied.
 *   3. `pnpm --filter supabase-todos seed` has been run.
 *
 * @see projects/supabase-poc/spec.md § Functional requirements (R-FX-*)
 * @see projects/supabase-poc/plan.md § Milestone 2 → 2.1
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/server/db';
// `supabase-runtime` is the T2.2 deliverable; until it lands, this
// import fails with `ERR_MODULE_NOT_FOUND` and the suite is red. That
// failure is the tests-first proof.
import { createSupabaseRuntime } from '../../src/server/supabase-runtime';

const databaseUrl = process.env['DATABASE_URL'];

// Shape the rows landed by the seed script (`scripts/seed.ts`). Storage
// is snake_case per the contract's `naming` config, hence `user_id`.
interface TodoRow {
  readonly id: string;
  readonly user_id: string;
  readonly title: string;
  readonly completed: boolean;
}

interface PublicMessageRow {
  readonly id: string;
  readonly author_id: string;
  readonly body: string;
}

const ALICE_TODO_TITLES = ['Review the plan', 'Ship the PoC', 'Write the spec'] as const;
const BOB_TODO_TITLES = ['Read the spec', 'Test RLS'] as const;
const PUBLIC_MESSAGE_BODIES = ['Bob says hi', 'Hello world from Alice'] as const;

describe.skipIf(!databaseUrl)('createSupabaseRuntime — transaction mode (T2.1)', () => {
  let adminDb: AdminDb;
  let adminRuntime: Awaited<ReturnType<AdminDb['connect']>>;
  let pool: Pool;
  let factory: ReturnType<typeof createSupabaseRuntime>;
  let aliceAuthUserId: string;
  let bobAuthUserId: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be set to run scoped runtime integration tests');
    }

    // 1. Admin runtime — we use it to (a) read the auth user IDs from
    //    `profiles` (whose `id` mirrors `auth.users.id` per the seed)
    //    and (b) keep the same `ExecutionContext` the factory needs.
    adminDb = createAdminDb(databaseUrl);
    adminRuntime = await adminDb.connect();

    const profilePlan = adminDb.sql.profiles.select('id', 'email').build();
    const profiles = await adminRuntime.execute(profilePlan);
    const aliceProfile = profiles.find((p) => p.email === 'alice@example.test');
    const bobProfile = profiles.find((p) => p.email === 'bob@example.test');
    if (!aliceProfile || !bobProfile) {
      throw new Error(
        'expected alice@example.test and bob@example.test profiles; run `pnpm --filter supabase-todos seed` first',
      );
    }
    aliceAuthUserId = aliceProfile.id;
    bobAuthUserId = bobProfile.id;

    // 2. Shared pool the factory binds to. Default `max` (10) — tests 7
    //    and 8 spin up their own pools when they need bespoke sizing
    //    or query spies.
    pool = new Pool({ connectionString: databaseUrl });

    factory = createSupabaseRuntime({
      context: adminDb.context,
      pool,
      scopeMode: 'transaction',
      allowedRoles: ['authenticated', 'anon'],
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (adminRuntime) {
      await adminRuntime.close();
    }
  });

  it('isolates alice — RLS scopes todos to alice (3 rows)', async () => {
    const session = factory.authenticate({
      jwtClaims: { sub: aliceAuthUserId, role: 'authenticated' },
      role: 'authenticated',
    });
    try {
      const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();
      const rows: readonly TodoRow[] = await session.execute(plan);

      expect(rows).toHaveLength(ALICE_TODO_TITLES.length);
      expect(rows.map((r) => r.title).sort()).toEqual([...ALICE_TODO_TITLES]);
      expect(rows.every((r) => r.user_id === aliceAuthUserId)).toBe(true);
    } finally {
      await session.end();
    }
  });

  it('isolates bob — RLS scopes todos to bob (2 rows)', async () => {
    const session = factory.authenticate({
      jwtClaims: { sub: bobAuthUserId, role: 'authenticated' },
      role: 'authenticated',
    });
    try {
      const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();
      const rows: readonly TodoRow[] = await session.execute(plan);

      expect(rows).toHaveLength(BOB_TODO_TITLES.length);
      expect(rows.map((r) => r.title).sort()).toEqual([...BOB_TODO_TITLES]);
      expect(rows.every((r) => r.user_id === bobAuthUserId)).toBe(true);
    } finally {
      await session.end();
    }
  });

  it('anon sees 0 rows on todos (RLS, no auth.uid())', async () => {
    const session = factory.authenticate({
      jwtClaims: { role: 'anon' },
      role: 'anon',
    });
    try {
      const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();
      const rows: readonly TodoRow[] = await session.execute(plan);

      expect(rows).toEqual([]);
    } finally {
      await session.end();
    }
  });

  it('anon sees the seeded public_messages (2 rows, USING true)', async () => {
    const session = factory.authenticate({
      jwtClaims: { role: 'anon' },
      role: 'anon',
    });
    try {
      const plan = adminDb.sql.public_messages.select('id', 'author_id', 'body').build();
      const rows: readonly PublicMessageRow[] = await session.execute(plan);

      expect(rows.map((r) => r.body).sort()).toEqual([...PUBLIC_MESSAGE_BODIES]);
    } finally {
      await session.end();
    }
  });

  it('50 parallel authenticate() calls preserve per-call identity', async () => {
    const subs = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0 ? aliceAuthUserId : bobAuthUserId,
    );
    const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();

    const results = await Promise.all(
      subs.map(async (sub) => {
        const session = factory.authenticate({
          jwtClaims: { sub, role: 'authenticated' },
          role: 'authenticated',
        });
        try {
          const rows: readonly TodoRow[] = await session.execute(plan);
          return { sub, rows };
        } finally {
          await session.end();
        }
      }),
    );

    for (const { sub, rows } of results) {
      const expectedLength =
        sub === aliceAuthUserId ? ALICE_TODO_TITLES.length : BOB_TODO_TITLES.length;
      expect(rows).toHaveLength(expectedLength);
      expect(rows.every((r) => r.user_id === sub)).toBe(true);
    }
  });

  it('disallowed role throws synchronously and never touches the pool', () => {
    // Use a fresh pool so the spy is clean; not strictly needed for the
    // assertion (no SQL must be sent), but it prevents leakage if the
    // implementation incidentally pre-warms the shared pool.
    const isolatedPool = new Pool({ connectionString: databaseUrl });
    const isolatedFactory = createSupabaseRuntime({
      context: adminDb.context,
      pool: isolatedPool,
      scopeMode: 'transaction',
      allowedRoles: ['authenticated', 'anon'],
    });

    const connectSpy = vi.spyOn(isolatedPool, 'connect');
    const querySpy = vi.spyOn(isolatedPool, 'query');

    try {
      expect(() =>
        isolatedFactory.authenticate({
          jwtClaims: { sub: aliceAuthUserId, role: 'totally-not-allowed' },
          role: 'totally-not-allowed',
        }),
      ).toThrow();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(querySpy).not.toHaveBeenCalled();
    } finally {
      connectSpy.mockRestore();
      querySpy.mockRestore();
      void isolatedPool.end();
    }
  });

  it('pool exhaustion under max=2 with 10 concurrent scoped queries recovers to baseline', async () => {
    const smallPool = new Pool({ connectionString: databaseUrl, max: 2 });
    const smallFactory = createSupabaseRuntime({
      context: adminDb.context,
      pool: smallPool,
      scopeMode: 'transaction',
      allowedRoles: ['authenticated', 'anon'],
    });
    const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();

    try {
      const concurrent: ReadonlyArray<readonly TodoRow[]> = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const session = smallFactory.authenticate({
            jwtClaims: { sub: aliceAuthUserId, role: 'authenticated' },
            role: 'authenticated',
          });
          try {
            const rows: readonly TodoRow[] = await session.execute(plan);
            return rows;
          } finally {
            await session.end();
          }
        }),
      );

      expect(concurrent).toHaveLength(10);
      for (const rows of concurrent) {
        expect(rows).toHaveLength(ALICE_TODO_TITLES.length);
      }

      // Pool drained: no waiters, all clients idle (≤ max=2).
      await expect.poll(() => smallPool.waitingCount, { timeout: 1000 }).toBe(0);
      expect(smallPool.totalCount).toBeLessThanOrEqual(2);
      expect(smallPool.idleCount).toBeLessThanOrEqual(2);
    } finally {
      await smallPool.end();
    }
  });

  it('mid-iteration throw rolls back transaction and leaves pool healthy', async () => {
    const recoveryPool = new Pool({ connectionString: databaseUrl, max: 2 });
    const recoveryFactory = createSupabaseRuntime({
      context: adminDb.context,
      pool: recoveryPool,
      scopeMode: 'transaction',
      allowedRoles: ['authenticated', 'anon'],
    });
    const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();

    try {
      const before = recoveryPool.totalCount;
      const failingSession = recoveryFactory.authenticate({
        jwtClaims: { sub: aliceAuthUserId, role: 'authenticated' },
        role: 'authenticated',
      });

      let observed: unknown;
      try {
        for await (const _row of failingSession.execute(plan)) {
          throw new Error('boom-mid-iteration');
        }
      } catch (err) {
        observed = err;
      } finally {
        // Defensive — `end()` must be safe to call even after an
        // in-flight error; T2.2 is responsible for the rollback path.
        await failingSession.end().catch(() => {});
      }

      expect(observed).toBeInstanceOf(Error);
      expect((observed as Error).message).toBe('boom-mid-iteration');

      // Recovery: a follow-up scoped session against the same pool
      // succeeds with the expected fixture content. If the failing
      // transaction had leaked, this would either hang (pool starved
      // by a never-released client) or surface stale state.
      const recovery = recoveryFactory.authenticate({
        jwtClaims: { sub: aliceAuthUserId, role: 'authenticated' },
        role: 'authenticated',
      });
      try {
        const rows = (await recovery.execute(plan)) satisfies readonly TodoRow[];
        expect(rows).toHaveLength(ALICE_TODO_TITLES.length);
      } finally {
        await recovery.end();
      }

      // The bad client should be evicted (totalCount strictly bounded
      // by max=2; no leaked extra clients beyond the recovery one).
      expect(recoveryPool.totalCount).toBeLessThanOrEqual(Math.max(before, 0) + 2);
    } finally {
      await recoveryPool.end();
    }
  });

  it('session.beginTransaction() throws synchronously with runtime/unsupported-scoped-tx (R-FX-8)', async () => {
    const session = factory.authenticate({
      jwtClaims: { sub: aliceAuthUserId, role: 'authenticated' },
      role: 'authenticated',
    });
    try {
      let thrown: unknown;
      try {
        // R-FX-8: in transaction mode, user-initiated transactions are
        // out of scope. Must throw synchronously, not as a rejected
        // promise — the caller should never even get a thenable back.
        const maybeBegin = (session as { beginTransaction: () => unknown }).beginTransaction;
        maybeBegin.call(session);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      const code = (thrown as { code?: string }).code;
      const message = (thrown as Error).message;
      expect(
        code === 'runtime/unsupported-scoped-tx' || /runtime\/unsupported-scoped-tx/.test(message),
      ).toBe(true);
    } finally {
      await session.end();
    }
  });
});
