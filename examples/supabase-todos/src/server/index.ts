/**
 * Hono server entry for the supabase-todos example (T4.13 prerequisite).
 *
 * Composes the JWT-verification middleware (T4.2) and the per-request
 * scoped-runtime middleware (T4.4) over the `/api/todos` (T4.6) and
 * `/api/public/messages` (T4.8) sub-apps, then listens on HTTP via
 * `@hono/node-server`. The Vite dev server (T4.9–T4.12, configured in
 * `vite.config.ts`) proxies `/api/*` here at runtime so the SPA can
 * call the API on the same origin.
 *
 * ## Middleware ordering
 *
 * Compose follows the wiring documented in
 * [`middleware/jwt.ts`](./middleware/jwt.ts) and
 * [`middleware/scoped-runtime.ts`](./middleware/scoped-runtime.ts):
 *
 * ```ts
 * .use('/api/public/*', publicRoute())  // marks public; must be first
 * .use('*', jwtAuth)                    // verifies bearer (skipped on public)
 * .use('*', scopedRuntime)              // attaches RLS-scoped session
 * .route('/api/todos', todosRoutes)
 * .route('/api/public/messages', publicMessagesRoutes)
 * ```
 *
 * `publicRoute()` lands as a path-prefix middleware **before** the
 * global JWT middleware so it short-circuits past JWT verification on
 * `/api/public/*` (Hono runs middleware in registration order; the
 * trap is documented at the publicRoute() JSDoc).
 *
 * ## CORS
 *
 * The server binds to `127.0.0.1:<HONO_PORT>` (default `8787`); the
 * Vite dev server runs on `127.0.0.1:5173` and proxies `/api/*` here
 * at the Vite layer (see `vite.config.ts`). With the proxy in place
 * the browser sees same-origin requests and CORS does not apply, so
 * we don't enable Hono's CORS middleware in the dev composition. If a
 * future deployment serves the SPA from a different origin, add
 * `import { cors } from 'hono/cors'` and `.use('*', cors({ origin:
 * <spa-origin> }))` ahead of the JWT middleware.
 *
 * ## Pool ownership
 *
 * `pg.Pool` is constructed once at server start and shared across the
 * factory's per-request sessions. The factory does not own the pool;
 * `pool.end()` runs in the SIGTERM/SIGINT handler. This is the same
 * shape the integration tests use (`new Pool({ connectionString })`
 * + `await pool.end()` in `afterAll`).
 *
 * @see projects/supabase-poc/spec.md § Hono server
 * @see projects/supabase-poc/plan.md § Milestone 4
 */
import { serve } from '@hono/node-server';
import 'dotenv/config';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { createAdminDb } from './db';
import { createJwtMiddleware, type JwtAuthEnv, publicRoute } from './middleware/jwt';
import { createScopedRuntimeMiddleware, type ScopedRuntimeEnv } from './middleware/scoped-runtime';
import { createPublicMessagesRoutes } from './routes/public-messages';
import { createTodosRoutes } from './routes/todos';
import { createSupabaseRuntime } from './supabase-runtime';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name}=${raw} is not a valid TCP port (1..65535).`);
  }
  return parsed;
}

const databaseUrl = readEnv('DATABASE_URL');
const jwtSecret = readEnv('SUPABASE_JWT_SECRET');
const port = readPort('HONO_PORT', 8787);

const adminDb = createAdminDb(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const factory = createSupabaseRuntime({
  context: adminDb.context,
  pool,
  scopeMode: 'transaction',
  allowedRoles: ['authenticated', 'anon'],
});

const app = new Hono<ScopedRuntimeEnv & JwtAuthEnv>();

// `/health` is registered as a leaf route **before** any `use('*')`
// middleware so a load balancer / smoke probe can hit it without a
// bearer token and without paying the per-request anon-session
// envelope (FL-19). Hono evaluates registered routes against the
// path first; the `use('*')` middleware below applies to the
// `/api/*` routes that come after.
app.get('/health', (c) => c.json({ ok: true }));

app
  .use('/api/public/*', publicRoute())
  .use('/api/*', createJwtMiddleware({ secret: jwtSecret }))
  .use('/api/*', createScopedRuntimeMiddleware({ factory }))
  .route('/api/todos', createTodosRoutes({ sql: adminDb.sql }))
  .route('/api/public/messages', createPublicMessagesRoutes({ sql: adminDb.sql }));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`[supabase-todos] Hono listening on http://${info.address}:${info.port}`);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[supabase-todos] received ${signal}, draining…`);
  server.close();
  try {
    await pool.end();
  } catch (err) {
    console.error('[supabase-todos] pool.end() failed', err);
  }
  process.exit(0);
}

process.on('SIGINT', (s) => void shutdown(s));
process.on('SIGTERM', (s) => void shutdown(s));
