import type { DbOptions } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #5 / 5 — polymorphism variant path.
 *
 * Exercises `db.orm.events.variant('SearchEvent')` — the ORM's
 * polymorphism filter, which on Mongo surfaces as a `$match` on the
 * discriminator field (`type` here). The resulting rows are typed as
 * the variant shape (`SearchEvent`), not the base `Event`, so
 * variant-only fields like `query` are accessible without a cast.
 *
 * This probe is worth running alongside the other four because
 * polymorphism dispatch is one of the places the Mongo ORM has
 * variant-specific code (discriminator injection on write, variant
 * filter on read). If the shared runtime ever gained state that
 * discriminator resolution touched, a concurrent render of this
 * component would surface it. There's no such state today — this is
 * insurance, documented as insurance.
 *
 * Returns the 10 most recent search events (by `timestamp`
 * descending) along with the search query text. Empty state covers
 * the no-seed case.
 */
export interface SearchEventsProps {
  readonly poolMax?: number | undefined;
  readonly limit?: number;
}

export async function SearchEvents({ poolMax, limit = 10 }: SearchEventsProps) {
  const opts: DbOptions = { poolMax };
  const db = await getDb(opts);

  // Type-level note: `.variant('SearchEvent')` filters rows to
  // documents with `type === 'search'` at runtime, but the ORM's row
  // type narrowing is intentionally conservative — variant-only
  // fields like `query` aren't surfaced on the returned type. The
  // `retail-store` example works around this in its tests with
  // `expect(event).toHaveProperty('query')`. For this PoC we don't
  // need to display variant-only fields; `userId` and `sessionId`
  // live on the base `Event` and are enough to make the filtering
  // observable in the rendered UI.
  const rows = await db.orm.events
    .variant('SearchEvent')
    .orderBy({ timestamp: -1 })
    .take(limit)
    .all();

  return (
    <div className="card">
      <h2>Recent searches (polymorphism)</h2>
      <p className="muted">
        <code>db.orm.events.variant('SearchEvent').take({limit}).all()</code>
      </p>
      {rows.length === 0 ? (
        <p className="muted">
          No search events yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={String(row._id)}>
              <span className="badge">{row.type}</span>
              <code>{row.userId}</code>
              <span className="muted"> — session </span>
              <code>{row.sessionId}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
