import type { DbOptions } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #2 / 5 — ORM with `.include()`.
 *
 * Exercises the ORM's multi-query include dispatch on the Mongo side:
 * the parent `find` on `orders` plus a follow-up `find` on `users`
 * keyed by the collected `userId`s. Under the hood these run as two
 * sequential MongoDB commands sharing the same pool.
 *
 * This is the Mongo analogue of the Postgres app's
 * `<PostsWithAuthors />`. The shapes differ (no transactions per
 * include, no `acquireRuntimeScope` to wrap the pair) but the
 * observable footprint is the same: one component, two commands, two
 * pool check-outs under concurrent rendering.
 *
 * Included in the five-component mix specifically to make the
 * command-count doubling visible in the `<DiagPanel />` — it makes
 * the contrast between single-query and multi-query components easy
 * to read during a manual stress run.
 */
export interface OrdersWithUserProps {
  readonly poolMax?: number | undefined;
  readonly limit?: number;
}

export async function OrdersWithUser({ poolMax, limit = 5 }: OrdersWithUserProps) {
  const opts: DbOptions = { poolMax };
  const db = await getDb(opts);
  const orders = await db.orm.orders.include('user').orderBy({ _id: -1 }).take(limit).all();

  return (
    <div className="card">
      <h2>Orders with users</h2>
      <p className="muted">
        <code>db.orm.orders.include('user').take({limit}).all()</code>
      </p>
      {orders.length === 0 ? (
        <p className="muted">
          No orders yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {orders.map((order) => (
            <li key={String(order._id)}>
              <code>{order.type}</code>
              <span className="muted"> — </span>
              <code>{order.user?.name ?? '(unknown user)'}</code>
              <span className="muted">
                {' '}
                ({order.items.length} item{order.items.length === 1 ? '' : 's'})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
