import { withTransaction } from '@prisma-next/sql-runtime';
import { createOrmClient } from './orm-client/client';
import { db } from './prisma/db';

interface Env {
  HYPERDRIVE: { connectionString: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });

    if (url.pathname === '/sql/users') {
      const limit = parseLimit(url.searchParams.get('limit'), 10);
      const rows = await runtime.execute(
        db.sql.user.select('id', 'email', 'displayName', 'kind', 'createdAt').limit(limit).build(),
      );
      return Response.json({ ok: true, route: 'sql/users', count: rows.length, rows });
    }

    if (url.pathname === '/orm/users') {
      const limit = parseLimit(url.searchParams.get('limit'), 10);
      const orm = createOrmClient(runtime);
      const rows = await orm.User.newestFirst().take(limit).all();
      return Response.json({ ok: true, route: 'orm/users', count: rows.length, rows });
    }

    if (url.pathname === '/orm/posts') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        return Response.json({ ok: false, error: 'userId required' }, { status: 400 });
      }
      const limit = parseLimit(url.searchParams.get('limit'), 10);
      const orm = createOrmClient(runtime);
      const rows = await orm.Post.forUser(userId)
        .orderBy((post) => post.createdAt.desc())
        .take(limit)
        .all();
      return Response.json({ ok: true, route: 'orm/posts', count: rows.length, rows });
    }

    if (url.pathname === '/tx/commit') {
      const userId = url.searchParams.get('userId');
      const newDisplayName = url.searchParams.get('displayName') ?? 'Updated';
      if (!userId) {
        return Response.json({ ok: false, error: 'userId required' }, { status: 400 });
      }
      const result = await withTransaction(runtime, async (tx) => {
        await tx.execute(
          db.sql.post
            .insert({
              title: `Post written in tx for ${userId}`,
              userId,
              createdAt: new Date(),
            })
            .build(),
        );
        await tx.execute(
          db.sql.user
            .update({ displayName: newDisplayName })
            .where((f, fns) => fns.eq(f.id, userId))
            .build(),
        );
        return { committed: true };
      });
      return Response.json({ ok: true, route: 'tx/commit', ...result });
    }

    if (url.pathname === '/tx/rollback') {
      try {
        await withTransaction(runtime, async (tx) => {
          await tx.execute(
            db.sql.user
              .update({ displayName: 'rolled-back-write' })
              .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
              .build(),
          );
          throw new Error('intentional rollback');
        });
        return Response.json({ ok: false, error: 'expected rollback but transaction committed' });
      } catch (err) {
        return Response.json({
          ok: true,
          route: 'tx/rollback',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (url.pathname === '/cursor/large') {
      const breakAfter = parseLimit(url.searchParams.get('break'), 50);
      const consumed: { id: string; title: string }[] = [];
      const iter = runtime.execute(
        db.sql.post
          .select('id', 'title')
          .orderBy((f) => f.createdAt, { direction: 'asc' })
          .build(),
      );
      for await (const row of iter) {
        consumed.push(row);
        if (consumed.length >= breakAfter) break;
      }
      return Response.json({
        ok: true,
        route: 'cursor/large',
        consumed: consumed.length,
        cancelled: true,
      });
    }

    if (url.pathname === '/orm/tasks') {
      const orm = createOrmClient(runtime);
      const tasks = await orm.Task.take(10).all();
      const bugs = await orm.Task.bugs().take(10).all();
      const features = await orm.Task.features().take(10).all();
      return Response.json({ ok: true, route: 'orm/tasks', tasks, bugs, features });
    }

    return Response.json(
      { ok: false, error: 'unknown route', path: url.pathname },
      { status: 404 },
    );
  },
};

function parseLimit(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
