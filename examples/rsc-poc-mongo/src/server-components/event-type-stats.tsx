import { acc } from '@prisma-next/mongo-query-builder';
import type { DbOptions } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #4 / 5 — aggregate pipeline via `$group`.
 *
 * Exercises the query-builder's `.group()` stage: group `events` by
 * their discriminator `type` and count occurrences. Result shape is
 * `[{ _id: string, count: number }, ...]`.
 *
 * This is the Mongo analogue of the Postgres app's
 * `<UserKindBreakdown />` — both probe the aggregate code path. On
 * Mongo, `$group` is a pipeline stage the adapter lowers into an
 * aggregate wire command, so the driver issues a single
 * `aggregate` command (one pool check-out, one command) regardless
 * of how many input documents there are.
 *
 * Included in the mix to verify aggregate plans compose safely with
 * the shared runtime under concurrent rendering. There is no
 * aggregate-specific mutable state in `MongoRuntimeImpl`, so this
 * should behave identically to the other components; the PoC
 * verifies rather than assumes.
 */
export interface EventTypeStatsProps {
  readonly poolMax?: number | undefined;
}

interface EventTypeCount {
  readonly _id: string;
  readonly count: number;
}

export async function EventTypeStats({ poolMax }: EventTypeStatsProps) {
  const opts: DbOptions = { poolMax };
  const db = await getDb(opts);

  const plan = db.query
    .from('events')
    .group((f) => ({
      _id: f.type,
      count: acc.count(),
    }))
    .sort({ count: -1 })
    .build();

  const rows: EventTypeCount[] = [];
  for await (const row of db.runtime.execute(plan)) {
    rows.push(row as EventTypeCount);
  }

  return (
    <div className="card">
      <h2>Event type breakdown</h2>
      <p className="muted">
        <code>
          db.query.from('events').group({'{'} _id: type, count: $count {'}'}).sort(...)
        </code>
      </p>
      {rows.length === 0 ? (
        <p className="muted">
          No events yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row._id}>
              <span className="badge">{row._id}</span>
              <code>{row.count}</code>
              <span className="muted"> events</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
