/**
 * Hono JWT-verification middleware (T4.2).
 *
 * Sits in front of authenticated route handlers. Reads
 * `Authorization: Bearer <token>`, verifies the token via `jose`
 * against a shared HS256 secret, and on success attaches a
 * `{ claims, role }` value to `c.var.jwt`. Failures short-circuit
 * with HTTP 401 and a stable error code (`auth/missing-bearer`,
 * `auth/invalid-token`, `auth/expired-token`) so callers can branch
 * on the failure mode without scraping prose.
 *
 * ## Why a shared secret (not JWKS) for the PoC
 *
 * Local Supabase signs access tokens with HS256 and a fixed secret
 * exposed via `supabase status -o env` (`JWT_SECRET=...`); the same
 * secret is configured for `gotrue` and validated by PostgREST. The
 * project plan's open item ("Supabase JWKS endpoint vs shared secret
 * for local dev") was resolved in favour of the **shared-secret**
 * default — JWKS would require an HTTP fetch per process startup,
 * caching, key rotation handling, etc. None of that is interesting
 * for a PoC whose goal is to exercise the RLS pipeline. A production
 * deployment can swap this out for a JWKS-backed verifier without
 * changing the middleware's surface (just construct a different
 * `secret` resolver).
 *
 * ## Public-route opt-out
 *
 * `publicRoute()` is a tiny marker middleware that sets
 * `c.var.public = true`. When composed *before* this middleware in
 * a route's chain, it causes verification to be skipped entirely:
 *
 * ```ts
 * app.get('/api/public/messages', publicRoute(), jwtAuth, scoped, handler);
 * ```
 *
 * The downstream scoped-runtime middleware (T4.4) reads
 * `c.var.public` to decide between an authenticated session and an
 * `anon`-scoped session.
 *
 * ## Error code namespace
 *
 * All failures from this middleware live under `auth/*`. The codes
 * are stable strings, deliberately chosen so frontends and tests
 * can switch on them:
 *
 * - `auth/missing-bearer` — no `Authorization` header, or the scheme
 *   is not `Bearer`.
 * - `auth/invalid-token` — malformed JWS, signature mismatch, or any
 *   non-claim verification failure.
 * - `auth/expired-token` — `exp` claim is in the past.
 *
 * The 401 body is `{ code, message }` — minimal but enough for tests
 * to assert on; richer error envelopes (e.g. PN's `ErrorEnvelope`)
 * can wrap this later without changing the wire shape.
 *
 * @see projects/supabase-poc/spec.md § Hono server (JWT verify)
 * @see projects/supabase-poc/plan.md § Milestone 4 → 4.2
 */
import type { MiddlewareHandler } from 'hono';
import { type JWTPayload, errors as joseErrors, jwtVerify } from 'jose';

/**
 * Shape attached to `c.var.jwt` on a successfully-verified request.
 * `claims` is the decoded JWT payload verbatim; `role` is the value
 * the per-request scoped-runtime middleware (T4.4) hands to
 * `factory.authenticate({ role })`. Defaults to `'authenticated'`
 * when the token has no explicit `role` claim.
 */
export interface JwtAuth {
  readonly claims: JWTPayload;
  readonly role: string;
}

/**
 * Hono `Env` shape for the JWT middleware. The downstream
 * scoped-runtime middleware (T4.4) extends this with a `db` variable.
 */
export type JwtAuthEnv = {
  Variables: {
    /** Set on success by `createJwtMiddleware`; undefined on public routes. */
    jwt?: JwtAuth;
    /** Set by `publicRoute()` to opt the request out of verification. */
    public?: boolean;
  };
};

export interface JwtMiddlewareOptions {
  /**
   * Shared HMAC secret used to verify the JWT signature. For local
   * Supabase this is `JWT_SECRET` from `supabase status -o env`; for
   * the example app it's wired in from `process.env['SUPABASE_JWT_SECRET']`
   * at the server entry. The middleware doesn't read env on its own
   * so unit tests can pin a known-good value.
   */
  readonly secret: string;
  /**
   * Optional algorithm allowlist. Defaults to `['HS256']` (the alg
   * Supabase signs with). Passing this through to `jose.jwtVerify`
   * is the only place where the alg is honoured — we don't read
   * `alg` from the protected header ourselves.
   */
  readonly algorithms?: readonly string[];
}

const DEFAULT_ALGORITHMS = ['HS256'] as const;

const BEARER_PREFIX_RE = /^Bearer\s+(.+)$/i;

/**
 * Build the JWT verification middleware. The middleware:
 *
 *   1. Short-circuits with success (no `c.var.jwt`) when
 *      `c.var.public === true` — letting `publicRoute()` opt routes
 *      out of verification entirely.
 *   2. Reads `Authorization: Bearer <token>`; missing or non-Bearer
 *      → 401 `auth/missing-bearer`.
 *   3. Verifies the token via `jose.jwtVerify` against the shared
 *      secret, restricted to HS256 by default. On success, attaches
 *      `c.var.jwt = { claims, role }` where `role` is `claims.role`
 *      (string) or `'authenticated'`.
 *   4. On verification failure, distinguishes `JWTExpired` from
 *      every other failure mode and emits the matching stable code.
 */
export function createJwtMiddleware(options: JwtMiddlewareOptions): MiddlewareHandler<JwtAuthEnv> {
  const secretBytes = new TextEncoder().encode(options.secret);
  const algorithms = [...(options.algorithms ?? DEFAULT_ALGORITHMS)];

  return async (c, next) => {
    if (c.var.public === true) {
      return next();
    }

    const header = c.req.header('Authorization');
    if (!header) {
      return c.json({ code: 'auth/missing-bearer', message: 'Missing Authorization header' }, 401);
    }
    const match = BEARER_PREFIX_RE.exec(header);
    if (!match || !match[1]) {
      return c.json(
        { code: 'auth/missing-bearer', message: 'Authorization header is not a Bearer token' },
        401,
      );
    }
    const token = match[1].trim();

    try {
      const { payload } = await jwtVerify(token, secretBytes, { algorithms });
      const role = typeof payload['role'] === 'string' ? payload['role'] : 'authenticated';
      c.set('jwt', { claims: payload, role });
      return next();
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return c.json({ code: 'auth/expired-token', message: 'JWT is expired' }, 401);
      }
      return c.json(
        {
          code: 'auth/invalid-token',
          message: err instanceof Error ? err.message : 'JWT verification failed',
        },
        401,
      );
    }
  };
}

/**
 * Marker middleware that opts a route out of JWT verification.
 *
 * **Ordering matters — compose `publicRoute()` *before* both
 * `createJwtMiddleware(...)` and the scoped-runtime middleware in
 * the route chain.** Hono runs middleware in registration order, so
 * if `jwtAuth` runs first it rejects the request with 401
 * `auth/missing-bearer` before the marker is ever set. The marker
 * sets `c.var.public = true`; the JWT middleware checks the flag at
 * the top of its handler and short-circuits past verification, and
 * the scoped-runtime middleware (T4.4) reads the same flag to attach
 * an `anon`-scoped session instead of an authenticated one.
 *
 * ```ts
 * // Right: marker before auth + scope.
 * app.get('/api/public/messages', publicRoute(), jwtAuth, scoped, handler);
 *
 * // Wrong: jwtAuth runs first and 401s before publicRoute() executes.
 * app.get('/api/public/messages', jwtAuth, publicRoute(), scoped, handler);
 * ```
 */
export function publicRoute(): MiddlewareHandler<JwtAuthEnv> {
  return async (c, next) => {
    c.set('public', true);
    await next();
  };
}
