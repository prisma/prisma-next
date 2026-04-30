import type { VerifyMode } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #1 / 5 — plain ORM read.
 *
 * Exercises the simplest ORM code path: `Collection.orderBy().take().all()`.
 * No includes, no aggregates, no extensions — this is the baseline shape
 * other components are measured against.
 *
 * Under concurrent rendering, each instance of this component acquires its
 * own connection via `acquireRuntimeScope()` → `runtime.connection()` →
 * `pool.connect()`. The `InstrumentedPool` records each acquire.
 */
export interface TopUsersProps {
  readonly verifyMode: VerifyMode;
  readonly poolMax?: number | undefined;
  readonly limit?: number;
}

export async function TopUsers({ verifyMode, poolMax, limit = 10 }: TopUsersProps) {
  const db = getDb({ verifyMode, poolMax });
  const users = await db.orm.User.orderBy((user) => user.createdAt.desc())
    .select('id', 'email', 'kind', 'createdAt')
    .take(limit)
    .all();

  return (
    <div className="card">
      <h2>Top users</h2>
      <p className="muted">
        <code>db.orm.User.orderBy(...).take({limit}).all()</code>
      </p>
      {users.length === 0 ? (
        <p className="muted">
          No users yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              <span className="badge">{user.kind}</span>
              <code>{user.email}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
