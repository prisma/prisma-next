/**
 * Integration spec for the public-messages endpoint (T4.7).
 *
 * Lands in `phase-4b` ahead of T4.8's implementation, so the commit
 * history records tests-first ordering (R-NF-4). Until
 * `src/server/routes/public-messages.ts` exists, the import below
 * fails and the suite is red.
 *
 * What this spec verifies (covers spec.md R-FE-5)
 * -----------------------------------------------
 * `GET /api/public/messages` is the canonical public-route endpoint:
 * it must return the seeded messages without a `Bearer` token
 * (anon-scoped session) and also when called with a valid bearer
 * (authenticated users see public content too — the RLS policy
 * grants `SELECT` to both `anon` and `authenticated`). The route is
 * marked with `publicRoute()` so the JWT middleware short-circuits
 * past verification and the scoped-runtime middleware attaches an
 * `anon` session by default; with a token, the chain still works
 * because verification runs **before** the marker decision and just
 * happens to also produce a valid `c.var.jwt`.
 *
 * The two-pronged anon vs. authenticated check is the primary
 * contract: any future "I'll just gate this with jwtAuth and lose
 * the public-route opt-out" regression breaks the anon path loudly.
 *
 * @see projects/supabase-poc/spec.md § R-FE-5
 * @see projects/supabase-poc/plan.md § Milestone 4 → 4.7, 4.8
 */
import 'dotenv/config';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../../src/server/db';
import { createJwtMiddleware, type JwtAuthEnv } from '../../../src/server/middleware/jwt';
import {
  createScopedRuntimeMiddleware,
  type ScopedRuntimeEnv,
} from '../../../src/server/middleware/scoped-runtime';
// `routes/public-messages` is the T4.8 deliverable; until it lands,
// this import fails with `ERR_MODULE_NOT_FOUND` and the suite is
// red. That failure is the tests-first proof.
import { createPublicMessagesRoutes } from '../../../src/server/routes/public-messages';
import {
  createSupabaseRuntime,
  type SupabaseRuntimeFactory,
} from '../../../src/server/supabase-runtime';

const databaseUrl = process.env['DATABASE_URL'];

const TEST_SECRET = 'test-jwt-secret-with-at-least-32-characters-long';
const SECRET_BYTES = new TextEncoder().encode(TEST_SECRET);

const PUBLIC_MESSAGE_BODIES = ['Bob says hi', 'Hello world from Alice'] as const;

interface PublicMessageRow {
  readonly id: string;
  readonly author_id: string;
  readonly body: string;
}

async function signTokenFor(sub: string, role = 'authenticated'): Promise<string> {
  return new SignJWT({ sub, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET_BYTES);
}

interface AppDeps {
  readonly factory: SupabaseRuntimeFactory;
  readonly sql: AdminDb['sql'];
}

function buildPublicMessagesApp(deps: AppDeps) {
  // Mount JWT middleware globally so authenticated requests through
  // the public route still populate c.var.jwt; the publicRoute()
  // marker on the public-messages routes themselves causes the JWT
  // middleware to skip verification when no bearer is sent. This
  // mirrors the production composition shape: the example's server
  // entry attaches JWT + scoped-runtime globally, and individual
  // routes opt out via publicRoute().
  return new Hono<ScopedRuntimeEnv & JwtAuthEnv>()
    .use('*', createJwtMiddleware({ secret: TEST_SECRET }))
    .use('*', createScopedRuntimeMiddleware({ factory: deps.factory }))
    .route('/api/public/messages', createPublicMessagesRoutes({ sql: deps.sql }));
}

describe.skipIf(!databaseUrl)('Public messages endpoint (T4.7)', () => {
  let adminDb: AdminDb;
  let adminRuntime: Awaited<ReturnType<AdminDb['connect']>>;
  let pool: Pool;
  let factory: SupabaseRuntimeFactory;
  let aliceAuthUserId: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be set to run public-messages integration tests');
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

  it('GET /api/public/messages — anon (no Bearer) reads the seeded messages', async () => {
    const app = buildPublicMessagesApp({ factory, sql: adminDb.sql });
    const res = await app.request('/api/public/messages');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly PublicMessageRow[];
    expect(rows.map((r) => r.body).sort()).toEqual([...PUBLIC_MESSAGE_BODIES]);
  });

  it('GET /api/public/messages — authenticated user also reads the seeded messages', async () => {
    const app = buildPublicMessagesApp({ factory, sql: adminDb.sql });
    const aliceToken = await signTokenFor(aliceAuthUserId);
    const res = await app.request('/api/public/messages', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly PublicMessageRow[];
    expect(rows.map((r) => r.body).sort()).toEqual([...PUBLIC_MESSAGE_BODIES]);
  });

  it('GET /api/public/messages — invalid bearer is bypassed (publicRoute marker wins)', async () => {
    // publicRoute() runs first and sets c.var.public; the JWT
    // middleware short-circuits past verification when the flag is
    // set, so even a deliberately-broken bearer doesn't 401 the
    // request. Pinned here so a future "actually verify even on
    // public routes" regression breaks loudly.
    const app = buildPublicMessagesApp({ factory, sql: adminDb.sql });
    const res = await app.request('/api/public/messages', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly PublicMessageRow[];
    expect(rows.map((r) => r.body).sort()).toEqual([...PUBLIC_MESSAGE_BODIES]);
  });
});
