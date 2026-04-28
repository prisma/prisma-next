/**
 * Hono server entry for the supabase-todos example.
 *
 * Composes the JWT-verification middleware and the per-request
 * scoped-runtime middleware over the `/api/todos` and
 * `/api/public/messages` sub-apps, then listens on HTTP via
 * `@hono/node-server`. The Vite dev server (configured in
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
 * .use('/api/public/*', publicRoute())          // marks public; must be first
 * .use('/api/*', jwtAuth)                       // verifies bearer (skipped on public)
 * .use('/api/*', scopedRuntime)                 // attaches RLS-scoped session
 * .route('/api/todos', todosRoutes)
 * .route('/api/public/messages', publicMessagesRoutes)
 * ```
 *
 * The `use()` middlewares are path-scoped to `/api/*` (not `*`) so
 * routes outside the API tree — e.g. `/health` registered as a leaf
 * route below — bypass JWT verification and the per-request anon
 * envelope (FL-19) entirely.
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
  // server.close() returns synchronously and accepts a callback that
  // fires once all in-flight connections have ended. Awaiting it
  // before pool.end() prevents an in-flight handler from hitting a
  // pool.connect() rejection mid-request: the server first refuses
  // *new* connections, lets existing ones drain, and only then do
  // we tear the pool down. Non-zero exit on drain or pool failure
  // so process supervisors (systemd / k8s / etc.) see the failed
  // shutdown signal rather than confusing it with a clean exit.
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[supabase-todos] graceful shutdown failed', err);
    process.exit(1);
  }
}

process.on('SIGINT', (s) => void shutdown(s));
process.on('SIGTERM', (s) => void shutdown(s));
