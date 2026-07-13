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
 *   directions of the integration: the session (and its user) is read
 *   through BetterAuth — whose adapter runs on the app's shared pool —
 *   and the app's own `Profile` row is read through the ORM. The
 *   `profile.userId` column is a real cross-space FK onto
 *   `"public"."user"(id)` (see the example test's cascade assertion).
 */
export function createAppServer(auth: Auth, appDb: AppDb): Server {
  const { db } = appDb;
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

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          session: { userId: session.session.userId, expiresAt: session.session.expiresAt },
          user: { id: session.user.id, name: session.user.name, email: session.user.email },
          profile,
        }),
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}
