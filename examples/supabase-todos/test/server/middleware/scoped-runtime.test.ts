/**
 * Vitest spec for the per-request scoped-runtime middleware (T4.3).
 *
 * Lands in `phase-4a` ahead of T4.4's implementation, so the commit
 * history records tests-first ordering (R-NF-4). Until
 * `src/server/middleware/scoped-runtime.ts` exists, the import below
 * fails and the suite is red — which is exactly what tests-first
 * wants.
 *
 * What this spec verifies (covers spec.md § Hono server: scoped runtime)
 * ----------------------------------------------------------------------
 * The middleware sits *after* the JWT middleware (T4.2) and turns
 * the per-request identity into an RLS-scoped `SupabaseSession`
 * attached to `c.var.db`. Handlers then call `c.var.db.execute(plan)`
 * without any explicit `WHERE user_id = ?` filtering — RLS does the
 * isolation. Concretely:
 *
 *   - When `c.var.jwt` is set (authenticated route), the middleware
 *     calls `factory.authenticate({ jwtClaims, role })` with the
 *     claims and role from the JWT middleware. The session executes
 *     against the live local Supabase Postgres stack and returns
 *     RLS-filtered rows (e.g. alice sees only alice's todos).
 *   - When `c.var.public` is true (public route, JWT verification
 *     was skipped), the middleware authenticates as `anon` with no
 *     claims so the handler can read `public_messages`.
 *   - `await session.end()` runs in a `finally` block on both the
 *     happy path and the handler-error path, with errors from
 *     `end()` logged but never replacing the handler's own error.
 *   - When neither `c.var.jwt` nor `c.var.public` is set, the
 *     middleware throws `middleware/jwt-not-attached` — a clear
 *     signal that the route is missing JWT or `publicRoute()`
 *     middleware in front of it.
 *
 * Why these are integration tests, not pure unit tests
 * ----------------------------------------------------
 * The factory under test is the real `createSupabaseRuntime` from
 * T2.2; mocking its session would re-test what `factory.test.ts`
 * already covers and would not surface integration bugs (e.g. the
 * scoped runtime not actually enforcing RLS through Hono's request
 * lifecycle). The suite skips when `DATABASE_URL` is absent, same
 * as the rest of the example's tests.
 *
 * @see projects/supabase-poc/spec.md § Hono server (scoped runtime)
 * @see projects/supabase-poc/plan.md § Milestone 4 → 4.3, 4.4
 */
import 'dotenv/config';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AdminDb, createAdminDb } from '../../../src/server/db';
import type { JwtAuth, JwtAuthEnv } from '../../../src/server/middleware/jwt';
// `middleware/scoped-runtime` is the T4.4 deliverable; until it
// lands, this import fails with `ERR_MODULE_NOT_FOUND` and the suite
// is red. That failure is the tests-first proof.
import {
  createScopedRuntimeMiddleware,
  type ScopedRuntimeEnv,
} from '../../../src/server/middleware/scoped-runtime';
import {
  createSupabaseRuntime,
  type SupabaseRuntimeFactory,
  type SupabaseSession,
} from '../../../src/server/supabase-runtime';

const databaseUrl = process.env['DATABASE_URL'];

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
const PUBLIC_MESSAGE_BODIES = ['Bob says hi', 'Hello world from Alice'] as const;

/**
 * Stand-in for the JWT middleware. The scoped-runtime middleware
 * cares only about `c.var.jwt` (authenticated) and `c.var.public`
 * (anon); driving them with a tiny synchronous helper keeps these
 * tests focused on the scoped-runtime contract rather than on
 * re-testing JWT verification (which `jwt.test.ts` already covers).
 */
function injectJwt(jwt: JwtAuth | undefined): MiddlewareHandler<JwtAuthEnv> {
  return async (c, next) => {
    if (jwt) c.set('jwt', jwt);
    await next();
  };
}

function injectPublic(): MiddlewareHandler<JwtAuthEnv> {
  return async (c, next) => {
    c.set('public', true);
    await next();
  };
}

/**
 * Wrap a real factory so each `authenticate()` returns a session
 * whose `end()` is observable. Used by the lifecycle tests below to
 * prove `end()` ran and (separately) to inject a failure into it.
 */
interface InstrumentedFactory {
  readonly factory: SupabaseRuntimeFactory;
  readonly endCallCount: () => number;
  readonly setEndError: (err: Error | null) => void;
}

function instrumentFactory(real: SupabaseRuntimeFactory): InstrumentedFactory {
  let calls = 0;
  let injectedError: Error | null = null;
  return {
    factory: {
      authenticate(options) {
        const session = real.authenticate(options);
        const wrapped: SupabaseSession = {
          execute: session.execute.bind(session),
          connection: session.connection.bind(session),
          telemetry: session.telemetry.bind(session),
          close: session.close.bind(session),
          beginTransaction: () => session.beginTransaction(),
          async end() {
            calls += 1;
            if (injectedError) throw injectedError;
            await session.end();
          },
        };
        return wrapped;
      },
    },
    endCallCount: () => calls,
    setEndError: (err) => {
      injectedError = err;
    },
  };
}

describe.skipIf(!databaseUrl)('createScopedRuntimeMiddleware (T4.3)', () => {
  let adminDb: AdminDb;
  let adminRuntime: Awaited<ReturnType<AdminDb['connect']>>;
  let pool: Pool;
  let factory: SupabaseRuntimeFactory;
  let aliceAuthUserId: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be set to run scoped-runtime middleware tests');
    }
    adminDb = createAdminDb(databaseUrl);
    adminRuntime = await adminDb.connect();
    const profilePlan = adminDb.sql.profiles.select('id', 'email').build();
    const profiles = await adminRuntime.execute(profilePlan);
    const aliceProfile = profiles.find((p) => p.email === 'alice@example.test');
    if (!aliceProfile) {
      throw new Error(
        'expected alice@example.test profile; run `pnpm --filter supabase-todos seed` first',
      );
    }
    aliceAuthUserId = aliceProfile.id;
    pool = new Pool({ connectionString: databaseUrl });
    factory = createSupabaseRuntime({
      context: adminDb.context,
      pool,
      scopeMode: 'transaction',
      allowedRoles: ['authenticated', 'anon'],
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminRuntime) await adminRuntime.close();
  });

  it('attaches an authenticated session; queries see RLS-scoped rows', async () => {
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/me/todos',
      injectJwt({
        claims: { sub: aliceAuthUserId, role: 'authenticated' },
        role: 'authenticated',
      }),
      createScopedRuntimeMiddleware({ factory }),
      async (c) => {
        const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();
        const rows: readonly TodoRow[] = await c.var.db.execute(plan);
        return c.json(rows);
      },
    );

    const res = await app.request('/me/todos');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly TodoRow[];
    expect(rows).toHaveLength(ALICE_TODO_TITLES.length);
    expect(rows.map((r) => r.title).sort()).toEqual([...ALICE_TODO_TITLES]);
    expect(rows.every((r) => r.user_id === aliceAuthUserId)).toBe(true);
  });

  it('public route: anon session reads seeded public_messages', async () => {
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/public/messages',
      injectPublic(),
      createScopedRuntimeMiddleware({ factory }),
      async (c) => {
        const plan = adminDb.sql.public_messages.select('id', 'author_id', 'body').build();
        const rows: readonly PublicMessageRow[] = await c.var.db.execute(plan);
        return c.json(rows);
      },
    );

    const res = await app.request('/public/messages');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly PublicMessageRow[];
    expect(rows.map((r) => r.body).sort()).toEqual([...PUBLIC_MESSAGE_BODIES]);
  });

  it('public route: anon session sees zero todos (RLS without auth.uid())', async () => {
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/public/todos-leak-check',
      injectPublic(),
      createScopedRuntimeMiddleware({ factory }),
      async (c) => {
        const plan = adminDb.sql.todos.select('id', 'user_id', 'title', 'completed').build();
        const rows: readonly TodoRow[] = await c.var.db.execute(plan);
        return c.json(rows);
      },
    );

    const res = await app.request('/public/todos-leak-check');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('runs session.end() after the success path', async () => {
    const instrumented = instrumentFactory(factory);
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/me/todos',
      injectJwt({
        claims: { sub: aliceAuthUserId, role: 'authenticated' },
        role: 'authenticated',
      }),
      createScopedRuntimeMiddleware({ factory: instrumented.factory }),
      async (c) => {
        const plan = adminDb.sql.todos.select('id').build();
        await c.var.db.execute(plan);
        return c.json({ ok: true });
      },
    );

    const res = await app.request('/me/todos');
    expect(res.status).toBe(200);
    expect(instrumented.endCallCount()).toBe(1);
  });

  it('runs session.end() after a handler error and propagates the original error', async () => {
    const instrumented = instrumentFactory(factory);
    const handlerError = new Error('handler exploded');
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/me/throws',
      injectJwt({
        claims: { sub: aliceAuthUserId, role: 'authenticated' },
        role: 'authenticated',
      }),
      createScopedRuntimeMiddleware({ factory: instrumented.factory }),
      async () => {
        throw handlerError;
      },
    );
    app.onError((err, c) => c.json({ message: err.message }, 500));

    const res = await app.request('/me/throws');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('handler exploded');
    expect(instrumented.endCallCount()).toBe(1);
  });

  it('errors during session.end() are logged but do not replace the original error', async () => {
    const instrumented = instrumentFactory(factory);
    const handlerError = new Error('handler exploded');
    const endError = new Error('end() boom');
    instrumented.setEndError(endError);

    const logged: unknown[] = [];
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/me/throws',
      injectJwt({
        claims: { sub: aliceAuthUserId, role: 'authenticated' },
        role: 'authenticated',
      }),
      createScopedRuntimeMiddleware({
        factory: instrumented.factory,
        logger: (err) => logged.push(err),
      }),
      async () => {
        throw handlerError;
      },
    );
    app.onError((err, c) => c.json({ message: err.message }, 500));

    const res = await app.request('/me/throws');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    // Original handler error wins; the end() failure was swallowed
    // into the logger, not raised.
    expect(body.message).toBe('handler exploded');
    expect(logged).toContain(endError);
  });

  it('throws middleware/jwt-not-attached when neither jwt nor public is set', async () => {
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/me/forgot-jwt',
      // No injectJwt / injectPublic / publicRoute / jwtAuth — the
      // route author forgot to compose authentication.
      createScopedRuntimeMiddleware({ factory }),
      (c) => c.text('unreachable'),
    );

    let caught: Error | undefined;
    app.onError((err, c) => {
      if (err instanceof Error) caught = err;
      return c.json({ ok: false }, 500);
    });

    await app.request('/me/forgot-jwt');
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { code?: string }).code).toBe('middleware/jwt-not-attached');
  });

  // Pins the boundary between the JWT middleware (which extracts `role`
  // from the token claims, defaulting to `'authenticated'`) and the
  // factory's `allowedRoles` allowlist (which enforces R-FX-5). A
  // valid bearer carrying `claims.role: 'admin'` flows through JWT
  // verification untouched — the JWT middleware does NOT pre-validate
  // the role against the factory's allowlist (the layers are decoupled
  // on purpose: the factory is the single point of enforcement). When
  // `factory.authenticate({ role: 'admin' })` is called inside
  // `openSession`, the factory throws synchronously *before*
  // constructing the driver / runtime, so no DB query is issued. The
  // throw propagates out of the middleware (it happens before the
  // `try { await next() … }` block) and lands in Hono's `onError` as
  // a 500. This test pins all three of those properties so a future
  // refactor can't silently regress any of them; cross-references
  // phase-4a code-review § Major 1.
  it('JWT role outside allowedRoles is rejected at the factory boundary (defense in depth)', async () => {
    const app = new Hono<ScopedRuntimeEnv>().get(
      '/me/admin-token',
      injectJwt({
        claims: { sub: aliceAuthUserId, role: 'admin' },
        role: 'admin',
      }),
      createScopedRuntimeMiddleware({ factory }),
      (c) => c.text('unreachable'),
    );
    let caught: Error | undefined;
    app.onError((err, c) => {
      if (err instanceof Error) caught = err;
      return c.json({ ok: false }, 500);
    });

    const connectSpy = vi.spyOn(pool, 'connect');
    const callsBefore = connectSpy.mock.calls.length;
    try {
      const res = await app.request('/me/admin-token');
      expect(res.status).toBe(500);
      expect(caught).toBeInstanceOf(Error);
      // The factory's role-rejection message names the rejected role
      // and lists allowedRoles, per phase-2 R-FX-5.
      expect((caught as Error).message).toMatch(/'admin'/);
      expect((caught as Error).message).toMatch(/allowedRoles/);
      // No DB query went out — the synchronous throw lands before
      // any pool.connect() call (cf. factory.test.ts § 'disallowed role
      // throws synchronously and never touches the pool').
      expect(connectSpy.mock.calls.length - callsBefore).toBe(0);
    } finally {
      connectSpy.mockRestore();
    }
  });
});
