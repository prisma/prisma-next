import { createServer, type Server } from 'node:http';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type { Auth } from './auth';
import type { AppDb } from './prisma/db';

/**
 * Minimal HTTP server:
 *
 * - `/api/auth/*` — BetterAuth's own handler (sign-up, sign-in, session,
 *   sign-out, …).
 * - `GET /api/me` — an authenticated endpoint demonstrating both
 *   directions of the integration: the session is read through
 *   BetterAuth (backed by the contract-typed adapter), and the app's
 *   `Profile` row is traversed to the pack's `User` model.
 *
 * The `profile → user` traversal reads each side through its typed view
 * (`db` for the app's `Profile`, `authDb` for the space's `User`) over
 * the shared pool. Cross-space relations are not navigable via the ORM's
 * `include()` in the current framework — the aggregate contract types
 * them `never` — so the app follows the FK explicitly; the FK itself is
 * real and enforced in the database (see the example test's cascade
 * assertion).
 */
export function createAppServer(auth: Auth, appDb: AppDb): Server {
  const { db, authDb } = appDb;
  const authHandler = toNodeHandler(auth);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/auth/')) {
      await authHandler(req, res);
      return;
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not authenticated' }));
        return;
      }

      const profile = await db.orm.public.Profile.where({ userId: session.user.id }).first();
      const user = profile
        ? await authDb.orm.public.User.where({ id: profile.userId }).first()
        : null;

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          session: { userId: session.session.userId, expiresAt: session.session.expiresAt },
          profile: profile ? { ...profile, user } : null,
        }),
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}
