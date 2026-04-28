/**
 * Per-request scoped-runtime middleware (T4.4).
 *
 * Sits *after* the JWT-verification middleware (T4.2) in a route's
 * chain. Turns the per-request identity (`c.var.jwt`) — or the
 * `publicRoute()` marker (`c.var.public`) — into an RLS-scoped
 * `SupabaseSession`, attaches it to `c.var.db`, and ensures
 * `session.end()` runs after the response regardless of whether the
 * handler succeeded, threw, or wrote a 4xx/5xx response itself.
 *
 * ## Wiring
 *
 * ```ts
 * // Authenticated route
 * app.get('/api/todos',
 *   jwtAuth,                              // T4.2 — sets c.var.jwt
 *   createScopedRuntimeMiddleware({ factory }),
 *   async (c) => {
 *     const rows = await c.var.db.execute(adminDb.sql.todos.select(...).build());
 *     return c.json(rows);
 *   },
 * );
 *
 * // Public route
 * app.get('/api/public/messages',
 *   publicRoute(),                         // T4.2 — sets c.var.public
 *   jwtAuth,                               // skips when c.var.public === true
 *   createScopedRuntimeMiddleware({ factory }),
 *   handler,
 * );
 * ```
 *
 * ## Cleanup contract
 *
 * - On the success path: `await next()` returns, the `finally` block
 *   awaits `session.end()`. Any error from `end()` is forwarded to
 *   the configured `logger` (default `console.error`) and swallowed
 *   — there is no upstream error to attach it to.
 * - On the handler-error path: `next()` rejects, the `finally` block
 *   awaits `session.end()` and forwards any failure to the logger,
 *   then re-throws the *original* error so Hono's error pipeline
 *   sees it. This is the "errors during `end()` are logged but
 *   don't replace the original response error" requirement; naive
 *   `await session.end()` outside the try would either swallow the
 *   handler error or replace it with the cleanup error.
 *
 * ## Programmer-error guard
 *
 * If neither `c.var.jwt` nor `c.var.public` is set, the middleware
 * throws `middleware/jwt-not-attached`. That can only happen if a
 * route was registered without `jwtAuth` *and* without
 * `publicRoute()` — i.e. the route author forgot to compose
 * authentication. Failing loudly here is much better than silently
 * authenticating as `anon` (a security footgun) or hanging on a
 * missing precondition.
 *
 * @see projects/supabase-poc/spec.md § Hono server (scoped runtime)
 * @see projects/supabase-poc/plan.md § Milestone 4 → 4.4
 */
import type { MiddlewareHandler } from 'hono';
import {
  isRoleNotAllowedError,
  type SupabaseRuntimeFactory,
  type SupabaseSession,
} from '../supabase-runtime';
import type { JwtAuthEnv } from './jwt';

/**
 * Hono `Env` shape exported for routes that consume `c.var.db`. Adds
 * `db` (the per-request `SupabaseSession`) on top of the JWT
 * middleware's `Variables`.
 */
export type ScopedRuntimeEnv = {
  Variables: JwtAuthEnv['Variables'] & {
    db: SupabaseSession;
  };
};

export interface ScopedRuntimeMiddlewareOptions {
  /**
   * The runtime factory the middleware borrows from. The example's
   * server entry constructs one factory (per process) and passes it
   * here; the factory itself owns no per-request state, so a single
   * instance handles the whole server lifetime.
   */
  readonly factory: SupabaseRuntimeFactory;
  /**
   * Optional sink for `session.end()` failures. Defaults to
   * `console.error`. Override in tests to assert the failure was
   * observed; override in production to route to your structured
   * logger.
   */
  readonly logger?: (err: unknown) => void;
}

interface JwtNotAttachedError extends Error {
  readonly code: 'middleware/jwt-not-attached';
}

function jwtNotAttachedError(): JwtNotAttachedError {
  const err = new Error(
    'createScopedRuntimeMiddleware: neither c.var.jwt nor c.var.public is set. ' +
      'Compose `jwtAuth` (for authenticated routes) or `publicRoute()` ' +
      '(for routes that should run as `anon`) before this middleware in the route chain.',
  ) as JwtNotAttachedError;
  Object.assign(err, { code: 'middleware/jwt-not-attached' as const });
  return err;
}

export function createScopedRuntimeMiddleware(
  options: ScopedRuntimeMiddlewareOptions,
): MiddlewareHandler<ScopedRuntimeEnv> {
  const log =
    options.logger ?? ((err: unknown) => console.error('[scoped-runtime] end() failed', err));

  return async (c, next) => {
    let session: SupabaseSession;
    try {
      session = openSession(options.factory, c.var.jwt, c.var.public === true);
    } catch (err) {
      // Map the factory's R-FX-5 allowlist rejection to a 403 — a
      // forged-but-valid JWT carrying `role: 'admin'` (or any value
      // outside `allowedRoles`) is an auth failure, not a server bug.
      // The factory throws synchronously *before* opening any
      // connection (cf. factory.test.ts § 'disallowed role throws
      // synchronously and never touches the pool'), so the failure
      // path here returns the response without any DB cleanup. Any
      // other throw from `openSession()` (the programmer-error
      // `middleware/jwt-not-attached` guard, an IDENT_PATTERN
      // rejection from a misconfigured `allowedRoles`) is still a
      // 500 — only the explicit R-FX-5 shape gets mapped, so an
      // unrelated bug doesn't quietly become a 403.
      if (isRoleNotAllowedError(err)) {
        return c.json(
          {
            error: {
              code: 'auth/role-not-allowed' as const,
              message: `Role '${err.role}' is not allowed for this server.`,
            },
          },
          403,
        );
      }
      throw err;
    }
    c.set('db', session);

    let handlerError: unknown;
    let handlerThrew = false;
    try {
      await next();
    } catch (err) {
      handlerError = err;
      handlerThrew = true;
    } finally {
      try {
        await session.end();
      } catch (endErr) {
        // Log instead of replacing the handler's error: the request's
        // observable failure mode is the handler error, not whatever
        // happened tearing down the per-request connection state.
        // (No FL filed: this is application-shaped policy, not a
        // framework gap. If `end()` semantics ever grow structured
        // propagation, the policy here would tighten naturally.)
        log(endErr);
      }
    }

    if (handlerThrew) {
      throw handlerError;
    }
    // Explicit `return` so TS noImplicitReturns is satisfied — the
    // role-not-allowed branch above returns a Response, so every
    // path of the function must terminate with an explicit return /
    // throw.
    return;
  };
}

function openSession(
  factory: SupabaseRuntimeFactory,
  jwt: JwtAuthEnv['Variables']['jwt'],
  isPublic: boolean,
): SupabaseSession {
  if (jwt) {
    return factory.authenticate({ jwtClaims: jwt.claims, role: jwt.role });
  }
  if (isPublic) {
    return factory.authenticate({ jwtClaims: {}, role: 'anon' });
  }
  throw jwtNotAttachedError();
}
