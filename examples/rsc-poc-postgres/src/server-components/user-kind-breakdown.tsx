import type { VerifyMode } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #4 / 5 — ORM `groupBy().having().aggregate()`.
 *
 * Exercises the aggregate dispatch path in `sql-orm-client`. Like the other
 * ORM components, this acquires a runtime scope for the duration of the
 * call; unlike the plain `all()` path, it emits a GROUP BY plan rather than
 * a SELECT, so it hits a slightly different compilation branch in
 * `query-plan-aggregate.ts`.
 *
 * Included in the five-component mix to make sure aggregate plans behave
 * correctly alongside simple reads under concurrent rendering — there is
 * no shared mutable state specific to aggregates, but exercising the path
 * is cheap insurance.
 */
export interface UserKindBreakdownProps {
  readonly verifyMode: VerifyMode;
  readonly poolMax?: number | undefined;
  readonly minUsers?: number;
}

export async function UserKindBreakdown({
  verifyMode,
  poolMax,
  minUsers = 1,
}: UserKindBreakdownProps) {
  const db = getDb({ verifyMode, poolMax });
  const grouped = await db.orm.User.groupBy('kind')
    .having((having) => having.count().gte(minUsers))
    .aggregate((aggregate) => ({
      totalUsers: aggregate.count(),
    }));

  const rows = [...grouped].sort((left, right) => left.kind.localeCompare(right.kind));

  return (
    <div className="card">
      <h2>User kind breakdown</h2>
      <p className="muted">
        <code>db.orm.User.groupBy('kind').having(count ≥ {minUsers}).aggregate(...)</code>
      </p>
      {rows.length === 0 ? (
        <p className="muted">No groups meet the threshold.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.kind}>
              <span className="badge">{row.kind}</span>
              <code>{row.totalUsers}</code>
              <span className="muted"> users</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
