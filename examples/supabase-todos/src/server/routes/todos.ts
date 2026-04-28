/**
 * Todos JSON API (T4.6).
 *
 * Five endpoints under `/api/todos`, mounted via
 * `app.route('/api/todos', createTodosRoutes({ sql: adminDb.sql }))`
 * after the JWT and scoped-runtime middleware in the parent app's
 * chain. The handlers never filter by `user_id`. **RLS is the
 * single point of per-user isolation.** A naive read like
 * `SELECT * FROM todos` returns only the authenticated user's rows
 * because the per-plan transaction runs `SET LOCAL ROLE
 * "authenticated"` plus `set_config('request.jwt.claims', …)` so
 * `auth.uid()` resolves correctly inside the policy `USING`
 * predicate.
 *
 * The "alice asks for bob's todo by id" leakage test in
 * `test/server/routes/todos.test.ts` proves it: `SELECT … WHERE id =
 * $1` returns zero rows under alice's session even though the row
 * exists, because RLS filters before the WHERE clause matches. The
 * handler maps zero rows → 404. **No per-user filter in the
 * handler.** A static-source check in the same test file pins this
 * (`f.user_id` and `columns.user_id` are banned outside `insert(...)`),
 * so a future PR that adds defensive `where(f => fns.eq(f.user_id, …))`
 * "for safety" breaks the test loudly.
 *
 * ## INSERT and the WITH CHECK predicate
 *
 * The migration's `todos_insert_own` policy has
 * `WITH CHECK (user_id = (auth.uid())::text)`, so the row that the
 * handler inserts must have `user_id` equal to the session's
 * `auth.uid()` — i.e. equal to `claims.sub`. The handler reads
 * `c.var.jwt.claims.sub` and supplies it as `user_id`. A malicious
 * caller cannot forge a different `user_id` via the request body:
 * we don't accept `user_id` from the body at all — it's an internal
 * column the server fills in from the verified JWT — and the policy's
 * WITH CHECK rejects mismatched rows at the DB layer regardless.
 *
 * ## SKILL.md note (per phase-4b discipline)
 *
 * "PN does not auto-populate insert columns from session GUCs" is a
 * real RLS-skill-shaped finding worth advising future authors about,
 * but it is already covered by SKILL.md § 5 (service-role guidance)
 * and § 6 (auth.uid() and anon). The phase-4b dispatch flagged this
 * as a possible SKILL.md update — declined: SKILL.md already covers
 * the underlying mechanic. Cross-link from a future revision if the
 * insert-supplies-user_id pattern surfaces as confusing.
 *
 * @see projects/supabase-poc/spec.md § R-FX-2, R-FE-3
 * @see projects/supabase-poc/plan.md § Milestone 4 → 4.6
 */
import { Hono } from 'hono';
import type { AdminDb } from '../db';
import type { ScopedRuntimeEnv } from '../middleware/scoped-runtime';

interface TodoCreateBody {
  readonly title?: unknown;
}

interface TodoPatchBody {
  readonly title?: unknown;
  readonly completed?: unknown;
}

export interface TodosRoutesOptions {
  /**
   * Shared SQL builder shape. Plans are shape-only — they carry no
   * session context — so a single `sql` proxy bound to the contract
   * is sufficient for every request, and we execute the resulting
   * plans against the per-request RLS-scoped session attached at
   * `c.var.db`. The example wires this in from `createAdminDb(url).sql`
   * at server start; tests pass the same `adminDb.sql` they use to
   * construct seed-data plans.
   */
  readonly sql: AdminDb['sql'];
}

/**
 * Build the `/api/todos` sub-app. The parent app must compose the
 * JWT and scoped-runtime middleware so `c.var.db` and `c.var.jwt`
 * are populated before any handler runs:
 *
 * ```ts
 * const adminDb = createAdminDb(url);
 * const app = new Hono<ScopedRuntimeEnv>()
 *   .use('*', createJwtMiddleware({ secret }))
 *   .use('*', createScopedRuntimeMiddleware({ factory }))
 *   .route('/api/todos', createTodosRoutes({ sql: adminDb.sql }));
 * ```
 */
export function createTodosRoutes(options: TodosRoutesOptions) {
  const { sql } = options;
  const app = new Hono<ScopedRuntimeEnv>();

  app.get('/', async (c) => {
    const plan = sql.todos.select('id', 'user_id', 'title', 'completed', 'created_at').build();
    const rows = await c.var.db.execute(plan);
    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const plan = sql.todos
      .select('id', 'user_id', 'title', 'completed', 'created_at')
      .where((f, fns) => fns.eq(f.id, id))
      .build();
    const rows = await c.var.db.execute(plan);
    const row = rows[0];
    if (!row) {
      return c.json({ code: 'todos/not-found', message: 'Todo not found' }, 404);
    }
    return c.json(row);
  });

  app.post('/', async (c) => {
    const claims = c.var.jwt?.claims;
    const sub = typeof claims?.['sub'] === 'string' ? claims['sub'] : undefined;
    if (!sub) {
      // Defense in depth: a public-route POST would be misconfigured
      // (anon cannot satisfy the WITH CHECK predicate anyway, and
      // the migration's `todos_insert_own` policy gates INSERT to
      // `authenticated` only). Fail with a clear 400 before the DB.
      return c.json(
        { code: 'todos/missing-sub', message: 'JWT claims.sub is required for POST /api/todos' },
        400,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as TodoCreateBody;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return c.json(
        {
          code: 'todos/invalid-body',
          message: '`title` is required and must be a non-empty string',
        },
        400,
      );
    }

    const plan = sql.todos
      .insert({ user_id: sub, title, completed: false })
      .returning('id', 'user_id', 'title', 'completed', 'created_at')
      .build();
    const rows = await c.var.db.execute(plan);
    const row = rows[0];
    if (!row) {
      // Should be unreachable: a successful INSERT with RETURNING
      // always yields one row. Surface as 500 to make it noisy if
      // it ever happens.
      return c.json({ code: 'todos/insert-no-row', message: 'INSERT returned no rows' }, 500);
    }
    return c.json(row, 201);
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as TodoPatchBody;
    const patch: { title?: string; completed?: boolean } = {};
    if (typeof body.title === 'string' && body.title.trim().length > 0) {
      patch.title = body.title.trim();
    }
    if (typeof body.completed === 'boolean') {
      patch.completed = body.completed;
    }
    if (Object.keys(patch).length === 0) {
      return c.json(
        {
          code: 'todos/invalid-body',
          message: 'At least one of `title` (string) or `completed` (boolean) is required',
        },
        400,
      );
    }

    const plan = sql.todos
      .update(patch)
      .where((f, fns) => fns.eq(f.id, id))
      .returning('id', 'user_id', 'title', 'completed', 'created_at')
      .build();
    const rows = await c.var.db.execute(plan);
    const row = rows[0];
    if (!row) {
      return c.json({ code: 'todos/not-found', message: 'Todo not found' }, 404);
    }
    return c.json(row);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const plan = sql.todos
      .delete()
      .where((f, fns) => fns.eq(f.id, id))
      .returning('id')
      .build();
    const rows = await c.var.db.execute(plan);
    if (rows.length === 0) {
      return c.json({ code: 'todos/not-found', message: 'Todo not found' }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
