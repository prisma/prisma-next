import type { DbOptions } from '../lib/db';
import { getDb } from '../lib/db';

/**
 * Server Component #1 / 5 — plain ORM read.
 *
 * Exercises the simplest Mongo ORM code path:
 * `Collection.orderBy().take().all()`. No includes, no aggregates,
 * no query-builder pipeline — this is the baseline shape other
 * components are measured against.
 *
 * Under concurrent rendering, each instance of this component issues
 * a MongoDB `find` command through the shared runtime. The Mongo
 * driver's internal pool checks out a connection for the duration of
 * the query and checks it back in on completion. `lib/db.ts` wires
 * `connectionCheckedOut` / `connectionCheckedIn` event listeners into
 * `lib/diag`, so each invocation bumps those counters.
 *
 * Unlike the Postgres app's `<TopUsers />`, there is no verification
 * round-trip to observe — `MongoRuntimeImpl` has no verification state
 * (hypothesis H5 in the project plan). That contrast is the entire
 * point of running the Mongo app alongside the Postgres one.
 */
export interface ProductListProps {
  readonly poolMax?: number | undefined;
  readonly limit?: number;
}

export async function ProductList({ poolMax, limit = 10 }: ProductListProps) {
  const opts: DbOptions = { poolMax };
  const db = await getDb(opts);
  const products = await db.orm.products.orderBy({ name: 1 }).take(limit).all();

  return (
    <div className="card">
      <h2>Products</h2>
      <p className="muted">
        <code>db.orm.products.orderBy(name).take({limit}).all()</code>
      </p>
      {products.length === 0 ? (
        <p className="muted">
          No products yet. Run <code>pnpm seed</code>.
        </p>
      ) : (
        <ul>
          {products.map((product) => (
            <li key={String(product._id)}>
              <span className="badge">{product.brand}</span>
              <code>{product.name}</code>
              <span className="muted"> — ${product.price.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
