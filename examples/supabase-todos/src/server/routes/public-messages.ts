/**
 * Public messages endpoint.
 *
 * Single read-only endpoint mounted via
 * `app.route('/api/public/messages', createPublicMessagesRoutes({ sql: adminDb.sql }))`.
 * The handler is intentionally the simplest possible shape: select
 * the seeded columns from `public_messages` and return them as JSON.
 * RLS handles "only return rows the caller is allowed to see"; the
 * migration's `public_messages_select_public` policy is `USING true`
 * granted to both `anon` and `authenticated`, so the same handler
 * works for signed-in and signed-out callers — exactly the design
 * intent of R-FE-5.
 *
 * ## Composition: how the route gets the publicRoute() marker
 *
 * `publicRoute()` must run *before* the JWT middleware (Hono runs
 * middleware in registration order). The parent app does that by
 * registering `publicRoute()` as a **path-prefix** middleware *before*
 * registering the JWT middleware globally:
 *
 * ```ts
 * const adminDb = createAdminDb(url);
 * const app = new Hono<ScopedRuntimeEnv>()
 *   // 1. Mark public paths FIRST so the JWT middleware can skip
 *   //    verification on them.
 *   .use('/api/public/*', publicRoute())
 *   // 2. Then JWT (short-circuits when c.var.public === true) and
 *   //    the scoped-runtime middleware (attaches an anon session
 *   //    when no jwt is set but c.var.public is).
 *   .use('*', createJwtMiddleware({ secret }))
 *   .use('*', createScopedRuntimeMiddleware({ factory }))
 *   // 3. Mount the route sub-apps.
 *   .route('/api/todos', createTodosRoutes({ sql: adminDb.sql }))
 *   .route('/api/public/messages', createPublicMessagesRoutes({ sql: adminDb.sql }));
 * ```
 *
 * The sub-app itself doesn't compose `publicRoute()` — putting it
 * *inside* `createPublicMessagesRoutes(...)` would land it after the
 * parent's global JWT middleware in execution order, defeating the
 * bypass. Documented loudly here and in the JWT middleware's JSDoc;
 * the wrong-ordering case is also tested in `jwt.test.ts`.
 *
 * ## Per-request anon-session overhead
 *
 * Every public request pays the transaction-mode envelope cost
 * (`BEGIN; set_config('request.jwt.claims', '{}', true); SET LOCAL
 * ROLE "anon"; SELECT ...; COMMIT`). For a hot endpoint this is
 * real friction; recorded as
 * [FL-19](../../../../projects/supabase-poc/framework-limitations.md).
 * The upstream design surface that would amortise the cost is
 * [Sketch 1 — Scoped-session SPI](../../../../projects/supabase-poc/framework-limitations.md#sketch-1--scoped-session-spi).
 *
 * @see projects/supabase-poc/spec.md § R-FE-5
 */
import { Hono } from 'hono';
import type { AdminDb } from '../db';
import type { ScopedRuntimeEnv } from '../middleware/scoped-runtime';

export interface PublicMessagesRoutesOptions {
  /** Shared SQL builder shape; see `TodosRoutesOptions.sql`. */
  readonly sql: AdminDb['sql'];
}

export function createPublicMessagesRoutes(options: PublicMessagesRoutesOptions) {
  const { sql } = options;
  const app = new Hono<ScopedRuntimeEnv>();

  app.get('/', async (c) => {
    const plan = sql.public_messages.select('id', 'author_id', 'body', 'created_at').build();
    const rows = await c.var.db.execute(plan);
    return c.json(rows);
  });

  return app;
}
