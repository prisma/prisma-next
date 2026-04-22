import type { VerifyMode } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #3 / 5 — SQL DSL path.
 *
 * Exercises the `db.sql` query builder plus direct `runtime.execute(plan)`.
 * Unlike the ORM components, this path does **not** go through
 * `acquireRuntimeScope()` — it executes directly against the runtime's
 * shared `execute()` method, which in `@prisma-next/postgres` delegates to
 * the driver's pool-backed queryable. Each execution still acquires and
 * releases a pool connection for the query's lifetime, but the runtime
 * state transitions (verification, telemetry) happen on the shared
 * instance rather than on a borrowed connection scope.
 *
 * This is the code path where H2 (redundant marker reads on cold start)
 * and H3 (skipped verification in `always` mode) are most directly
 * observable: every `execute()` consults `verifyPlanIfNeeded()` before
 * touching the driver.
 */
export interface RecentPostsRawProps {
  readonly verifyMode: VerifyMode;
  readonly poolMax?: number | undefined;
  readonly limit?: number;
}

export async function RecentPostsRaw({ verifyMode, poolMax, limit = 10 }: RecentPostsRawProps) {
  const db = getDb({ verifyMode, poolMax });
  const plan = db.sql.post
    .select('id', 'title', 'userId', 'createdAt')
    .orderBy('createdAt', { direction: 'desc' })
    .limit(limit)
    .build();
  const posts = await db.runtime().execute(plan);

  return (
    <div className="card">
      <h2>Recent posts (SQL DSL)</h2>
      <p className="muted">
        <code>db.sql.post.select(...).orderBy(...).limit({limit}).build()</code>
      </p>
      {posts.length === 0 ? (
        <p className="muted">
          No posts yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {posts.map((post) => (
            <li key={post.id}>
              <code>{post.title}</code>
              <span className="muted"> — user </span>
              <code>{post.userId}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
