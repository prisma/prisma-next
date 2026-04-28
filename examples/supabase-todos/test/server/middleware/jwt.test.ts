/**
 * Vitest spec for the Hono JWT-verification middleware.
 *
 * What this spec verifies (covers spec.md § Hono server: JWT verify)
 * ------------------------------------------------------------------
 * The middleware sits in front of authenticated route handlers and
 * gates them on a valid HS256-signed Supabase JWT carried as
 * `Authorization: Bearer <token>`. On success it attaches a
 * `{ claims, role }` value to `c.var.jwt`; on failure it short-circuits
 * with HTTP 401 and a stable error code so callers (UI / tests) can
 * branch on the failure mode without scraping prose.
 *
 * Public routes opt OUT of verification by composing a `publicRoute()`
 * marker middleware *before* the JWT middleware in the per-route
 * chain. The marker sets a flag the JWT middleware checks first; if
 * present, verification is skipped entirely and `c.var.jwt` is left
 * undefined (the per-request scoped-runtime middleware picks this up
 * and attaches an `anon` session instead).
 *
 * Why a fixed test secret rather than env coupling
 * ------------------------------------------------
 * The middleware factory accepts the secret as a config field so unit
 * tests can pin a known-good value without touching `process.env`.
 * The example's real wiring reads `process.env['SUPABASE_JWT_SECRET']`
 * at the server entry and forwards it; this layer doesn't care where
 * the bytes came from. Local Supabase publishes the secret via
 * `supabase status -o env` (`JWT_SECRET=...`) and pins it via
 * `supabase/config.toml` for reproducibility.
 *
 * @see projects/supabase-poc/spec.md § Hono server (JWT verify)
 */
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  createJwtMiddleware,
  type JwtAuthEnv,
  publicRoute,
} from '../../../src/server/middleware/jwt';

// 32+ chars to satisfy HS256 minimum; matches the local Supabase
// stack's well-known dev secret shape (`supabase status -o env` →
// `JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long`).
// Pinned here so tests don't depend on env state.
const TEST_SECRET = 'test-jwt-secret-with-at-least-32-characters-long';
const SECRET_BYTES = new TextEncoder().encode(TEST_SECRET);

interface ErrorBody {
  readonly code: string;
  readonly message?: string;
}

async function signJwt(
  payload: Record<string, unknown>,
  options: { expiresIn?: string; expiredAt?: number } = {},
): Promise<string> {
  const builder = new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (options.expiredAt !== undefined) {
    return builder.setExpirationTime(options.expiredAt).sign(SECRET_BYTES);
  }
  return builder.setExpirationTime(options.expiresIn ?? '1h').sign(SECRET_BYTES);
}

function buildApp() {
  const app = new Hono<JwtAuthEnv>();
  const jwt = createJwtMiddleware({ secret: TEST_SECRET });

  // Authenticated route — the canonical "Bearer required" surface.
  app.get('/protected', jwt, (c) =>
    c.json({
      jwt: c.var.jwt ?? null,
    }),
  );

  // Public route — `publicRoute()` runs before `jwt` and opts out
  // of verification. The handler still gets to look at `c.var.jwt`,
  // which is undefined when no bearer was sent.
  app.get('/public', publicRoute(), jwt, (c) =>
    c.json({
      jwt: c.var.jwt ?? null,
    }),
  );

  return app;
}

describe('createJwtMiddleware', () => {
  it('valid token populates c.var.jwt with claims and derived role', async () => {
    const app = buildApp();
    const token = await signJwt({ sub: 'user-1', role: 'authenticated', aud: 'authenticated' });

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: { claims: Record<string, unknown>; role: string } };
    expect(body.jwt.role).toBe('authenticated');
    expect(body.jwt.claims['sub']).toBe('user-1');
    expect(body.jwt.claims['role']).toBe('authenticated');
  });

  it('role defaults to "authenticated" when claims.role is absent', async () => {
    const app = buildApp();
    const token = await signJwt({ sub: 'user-2' });

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: { role: string } };
    expect(body.jwt.role).toBe('authenticated');
  });

  it('role propagates from claims.role for non-default roles (e.g. anon)', async () => {
    const app = buildApp();
    const token = await signJwt({ role: 'anon' });

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: { role: string } };
    expect(body.jwt.role).toBe('anon');
  });

  it('missing Authorization header → 401 auth/missing-bearer', async () => {
    const app = buildApp();
    const res = await app.request('/protected');

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('auth/missing-bearer');
  });

  it('Authorization without Bearer scheme → 401 auth/missing-bearer', async () => {
    const app = buildApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('auth/missing-bearer');
  });

  it('malformed token (not a JWS) → 401 auth/invalid-token', async () => {
    const app = buildApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('auth/invalid-token');
  });

  it('signature with wrong secret → 401 auth/invalid-token', async () => {
    const app = buildApp();
    const wrongSecret = new TextEncoder().encode(
      'different-secret-but-also-at-least-32-chars-long',
    );
    const token = await new SignJWT({ sub: 'user-1', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongSecret);

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('auth/invalid-token');
  });

  it('expired token → 401 auth/expired-token', async () => {
    const app = buildApp();
    // exp 60s in the past
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    const token = await signJwt({ sub: 'user-1', role: 'authenticated' }, { expiredAt });

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('auth/expired-token');
  });

  it('publicRoute() preceding jwt bypasses verification (no bearer required)', async () => {
    const app = buildApp();
    const res = await app.request('/public');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: unknown };
    expect(body.jwt).toBeNull();
  });

  it('publicRoute() bypasses verification even when an invalid bearer is sent', async () => {
    const app = buildApp();
    const res = await app.request('/public', {
      headers: { Authorization: 'Bearer garbage' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: unknown };
    expect(body.jwt).toBeNull();
  });
});
