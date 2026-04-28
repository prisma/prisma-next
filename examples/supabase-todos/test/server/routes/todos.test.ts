/**
 * Integration spec for the Todos JSON API (T4.5).
 *
 * Lands in `phase-4b` ahead of T4.6's implementation, so the commit
 * history records tests-first ordering (R-NF-4). Until
 * `src/server/routes/todos.ts` exists, the import below fails and
 * the suite is red — which is exactly what tests-first wants.
 *
 * What this spec verifies (covers spec.md R-FE-3, R-FX-1, R-FX-2)
 * --------------------------------------------------------------
 * Four endpoints under `/api/todos` exercised end-to-end against the
 * live local Supabase Postgres stack via the JWT + scoped-runtime
 * middleware composed in phase-4a:
 *
 *   - `GET    /api/todos`        — list the authenticated user's todos
 *   - `GET    /api/todos/:id`    — fetch one (404 if not the user's)
 *   - `POST   /api/todos`        — create (RLS WITH CHECK enforces
 *                                    `user_id = auth.uid()`)
 *   - `PATCH  /api/todos/:id`    — partial update (404 if not the user's)
 *   - `DELETE /api/todos/:id`    — delete (404 if not the user's)
 *
 * The two cross-user-leakage tests (alice asks for bob's todo by id;
 * alice tries to PATCH/DELETE bob's todo by id) **must** return 404,
 * not 200/403/500. The 404 is the proof that RLS filtered the row
 * out before the WHERE id=$1 clause matched anything — the handler
 * sees zero rows and reports the not-found shape, exactly as it
 * would for a non-existent id. Any other status code would mean
 * either RLS isn't doing its job (200) or the handler is doing
 * defensive per-user filtering of its own (403) — both of which
 * violate R-FX-2 and the project's "RLS handles isolation" thesis.
 *
 * The static-source test below pins R-FX-2 with a check that the
 * handler source contains no per-user `WHERE` filter. A future PR
 * that adds a defensive `where(f => fns.eq(f.user_id, …))` to
 * placate a code reviewer breaks the test loudly — which is the
 * whole point.
 *
 * @see projects/supabase-poc/spec.md § R-FX-2, R-FE-3
 * @see projects/supabase-poc/plan.md § Milestone 4 → 4.5, 4.6
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
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
// `routes/todos` is the T4.6 deliverable; until it lands, this
// import fails with `ERR_MODULE_NOT_FOUND` and the suite is red.
// That failure is the tests-first proof.
import { createTodosRoutes } from '../../../src/server/routes/todos';
import {
  createSupabaseRuntime,
  type SupabaseRuntimeFactory,
} from '../../../src/server/supabase-runtime';

const databaseUrl = process.env['DATABASE_URL'];

const TEST_SECRET = 'test-jwt-secret-with-at-least-32-characters-long';
const SECRET_BYTES = new TextEncoder().encode(TEST_SECRET);

interface TodoRow {
  readonly id: string;
  readonly user_id: string;
  readonly title: string;
  readonly completed: boolean;
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

function buildTodosApp(deps: AppDeps) {
  return new Hono<ScopedRuntimeEnv & JwtAuthEnv>()
    .use('*', createJwtMiddleware({ secret: TEST_SECRET }))
    .use('*', createScopedRuntimeMiddleware({ factory: deps.factory }))
    .route('/api/todos', createTodosRoutes({ sql: deps.sql }));
}

describe.skipIf(!databaseUrl)('Todos JSON API (T4.5)', () => {
  let adminDb: AdminDb;
  let adminRuntime: Awaited<ReturnType<AdminDb['connect']>>;
  let pool: Pool;
  let factory: SupabaseRuntimeFactory;
  let aliceAuthUserId: string;
  let bobAuthUserId: string;
  let aliceTodoId: string;
  let bobTodoId: string;
  let aliceToken: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be set to run Todos API integration tests');
    }
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

    // Pick one seeded todo per user **deterministically** (by title)
    // so any test ordering / DB row-order shuffle still picks the
    // same fixture row, and so write tests don't accidentally land
    // on a row whose title other suites assert against. The seed
    // titles are stable: alice owns 'Review the plan', 'Ship the PoC',
    // 'Write the spec'; bob owns 'Read the spec', 'Test RLS'. Routes
    // tests **only read** from these seeded rows; writes (PATCH/POST/
    // DELETE) operate on transient per-test rows so concurrent suites
    // (admin / factory / scoped-runtime) see a stable seed snapshot.
    //
    // If a fresh clone hits this `beforeAll` and the find-by-title
    // throws, the DB has drifted out from under the seed. The seed is
    // idempotent but not convergent (cf. scripts/seed.ts docblock):
    // re-running `pnpm seed` won't repair drifted titles. Recovery is
    // `supabase db reset` from `examples/supabase-todos/`, then
    // `pnpm migrate:up && pnpm seed` to rebuild the baseline.
    const todoPlan = adminDb.sql.todos.select('id', 'user_id', 'title').build();
    const todos = await adminRuntime.execute(todoPlan);
    const aliceTodo = todos.find(
      (t) => t.user_id === aliceAuthUserId && t.title === 'Review the plan',
    );
    const bobTodo = todos.find((t) => t.user_id === bobAuthUserId && t.title === 'Read the spec');
    if (!aliceTodo || !bobTodo) {
      throw new Error(
        'expected the canonical seed titles; run `pnpm --filter supabase-todos seed` first',
      );
    }
    aliceTodoId = aliceTodo.id;
    bobTodoId = bobTodo.id;

    pool = new Pool({ connectionString: databaseUrl });
    factory = createSupabaseRuntime({
      context: adminDb.context,
      pool,
      scopeMode: 'transaction',
      allowedRoles: ['authenticated', 'anon'],
    });
    aliceToken = await signTokenFor(aliceAuthUserId);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminRuntime) await adminRuntime.close();
  });

  it('GET /api/todos — alice sees only alice\u2019s todos (RLS-scoped)', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const res = await app.request('/api/todos', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly TodoRow[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === aliceAuthUserId)).toBe(true);
  });

  it('GET /api/todos — bob sees only bob\u2019s todos (RLS-scoped)', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const bobToken = await signTokenFor(bobAuthUserId);
    const res = await app.request('/api/todos', {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as readonly TodoRow[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === bobAuthUserId)).toBe(true);
  });

  it('GET /api/todos/:id — alice fetching her own todo returns 200', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const res = await app.request(`/api/todos/${aliceTodoId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as TodoRow;
    expect(row.id).toBe(aliceTodoId);
    expect(row.user_id).toBe(aliceAuthUserId);
  });

  it('GET /api/todos/:id — alice fetching bob\u2019s todo by id returns 404 (RLS filtered)', async () => {
    // The 404 is the proof that RLS did the work: the row exists in
    // the table but the SELECT, scoped to alice, sees zero rows. Any
    // other status code (200/403) would mean RLS is bypassed or the
    // handler did its own filtering.
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const res = await app.request(`/api/todos/${bobTodoId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/todos — alice creates a todo with user_id taken from claims.sub', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const title = `phase-4b-create-${Date.now()}`;
    const res = await app.request('/api/todos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
    // Read the body before any assertions so the cleanup id is
    // available regardless of which assertion fails. The 201 status
    // is asserted *after* the row is captured.
    const created = res.status === 201 ? ((await res.json()) as TodoRow) : null;

    try {
      expect(res.status).toBe(201);
      if (!created) throw new Error('unreachable: status was 201 but body parse skipped');
      expect(created.title).toBe(title);
      expect(created.user_id).toBe(aliceAuthUserId);
      expect(created.completed).toBe(false);
    } finally {
      // Always clean up via the admin runtime (RLS-bypass) so a
      // failed assertion above does not leak a row that other
      // suites' seed-fixture counts would then trip over.
      if (created) {
        const delPlan = adminDb.sql.todos
          .delete()
          .where((f, fns) => fns.eq(f.id, created.id))
          .build();
        await adminRuntime.execute(delPlan);
      }
    }
  });

  it('PATCH /api/todos/:id — alice updates her own todo', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    // Use a transient row so the seed data stays untouched (other
    // suites assert exact seed counts / titles, so mutating
    // 'Review the plan' or 'Ship the PoC' would race with them).
    const createRes = await app.request('/api/todos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: `phase-4b-patch-fixture-${Date.now()}` }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as TodoRow;

    try {
      const newTitle = `phase-4b-patched-${Date.now()}`;
      const res = await app.request(`/api/todos/${created.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle, completed: true }),
      });
      expect(res.status).toBe(200);
      const row = (await res.json()) as TodoRow;
      expect(row.id).toBe(created.id);
      expect(row.title).toBe(newTitle);
      expect(row.completed).toBe(true);
    } finally {
      // Always clean up — even if the assertion above failed.
      const cleanupPlan = adminDb.sql.todos
        .delete()
        .where((f, fns) => fns.eq(f.id, created.id))
        .build();
      await adminRuntime.execute(cleanupPlan);
    }
  });

  it('PATCH /api/todos/:id — alice patching bob\u2019s todo returns 404 (RLS filtered)', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const res = await app.request(`/api/todos/${bobTodoId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(404);

    // Defense: confirm bob's row was not actually mutated (an RLS
    // misconfig that surfaced the row to alice's UPDATE would have
    // changed `completed` even though the API returned 404 — pin
    // both legs).
    const checkPlan = adminDb.sql.todos
      .select('id', 'completed')
      .where((f, fns) => fns.eq(f.id, bobTodoId))
      .build();
    const [bob] = await adminRuntime.execute(checkPlan);
    if (!bob) throw new Error('bob todo missing — seed data inconsistent');
    expect(bob.completed).toBe(false);
  });

  it('DELETE /api/todos/:id — alice deleting bob\u2019s todo returns 404 (RLS filtered)', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const res = await app.request(`/api/todos/${bobTodoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(404);

    // Defense: bob's row still present.
    const checkPlan = adminDb.sql.todos
      .select('id')
      .where((f, fns) => fns.eq(f.id, bobTodoId))
      .build();
    const rows = await adminRuntime.execute(checkPlan);
    expect(rows).toHaveLength(1);
  });

  it('DELETE /api/todos/:id — alice deleting her own freshly-created todo returns 204', async () => {
    const app = buildTodosApp({ factory, sql: adminDb.sql });
    const createRes = await app.request('/api/todos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: `phase-4b-delete-${Date.now()}` }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as TodoRow;

    try {
      const delRes = await app.request(`/api/todos/${created.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      expect(delRes.status).toBe(204);

      // Confirm via admin runtime (RLS-bypassing) that it really is gone.
      const verifyPlan = adminDb.sql.todos
        .select('id')
        .where((f, fns) => fns.eq(f.id, created.id))
        .build();
      const remaining = await adminRuntime.execute(verifyPlan);
      expect(remaining).toEqual([]);
    } finally {
      // Defense for the failure path: if the API DELETE didn't
      // actually drop the row (e.g. handler regressed and returned
      // 204 without executing the plan), the throwaway row would
      // otherwise stick around and pollute future runs. Clean up
      // via the admin runtime regardless of the assertions above.
      const cleanupPlan = adminDb.sql.todos
        .delete()
        .where((f, fns) => fns.eq(f.id, created.id))
        .build();
      await adminRuntime.execute(cleanupPlan);
    }
  });

  // R-FX-2 static-source pin: the handler **must not** filter by
  // user_id. RLS is the single point of per-user isolation. A future
  // PR that adds a defensive `.where((f, fns) => fns.eq(f.user_id, …))`
  // breaks this test loudly, which is the point.
  //
  // The legitimate uses of `user_id` in the handler are:
  //   - `user_id: claims.sub` in the INSERT body (the WITH CHECK
  //     policy requires the handler to supply user_id; the policy
  //     enforces it equals auth.uid()).
  //   - References inside docblock prose / comments.
  //
  // What we ban: any column-builder access of the user_id field
  // (`f.user_id` / `f.userId`, `tables.todos.columns.user_id`, …)
  // and any literal `WHERE user_id` SQL fragment.
  it('handler source contains no per-user WHERE filter (R-FX-2)', async () => {
    const raw = await readFile(
      new URL('../../../src/server/routes/todos.ts', import.meta.url),
      'utf8',
    );
    // Strip block (`/* ... */`) and line (`// ...`) comments so the
    // regex only inspects executable code. Without this the static
    // pin would false-match on the docblock that explains *why*
    // these patterns are banned (the prose itself mentions
    // `f.user_id` etc.).
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/WHERE\s+user_id/i);
    expect(code).not.toMatch(/\bf\.user_id\b/);
    expect(code).not.toMatch(/\bf\.userId\b/);
    expect(code).not.toMatch(/columns\.user_id\b/);
    expect(code).not.toMatch(/columns\.userId\b/);
  });
});
