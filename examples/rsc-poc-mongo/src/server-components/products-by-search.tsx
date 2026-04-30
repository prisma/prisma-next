import { MongoFieldFilter, MongoOrExpr } from '@prisma-next/mongo-query-ast/execution';
import { MongoParamRef } from '@prisma-next/mongo-value';
import type { DbOptions } from '../lib/db';
import { getDb } from '../lib/db';
import type { FieldOutputTypes } from '../prisma/contract.d';

type Product = FieldOutputTypes['Product'];

/**
 * Server Component #3 / 5 — query-builder pipeline path.
 *
 * Exercises `db.query.from(...).match(...).sort(...).limit(...).build()`
 * followed by direct `runtime.execute(plan)`. This is the Mongo
 * analogue of the Postgres app's `<RecentPostsRaw />` — the component
 * that bypasses the ORM entirely and drops to the query-builder +
 * runtime pair.
 *
 * Worth covering in the five-component mix because the
 * query-builder path produces a `MongoQueryPlan` that goes through a
 * different code path than ORM operations: the ORM's
 * `MongoCollectionImpl` translates its state into wire commands via
 * internal builders, while `mongoQuery` produces the plan directly
 * from the chainable builder API. If the runtime ever grows shared
 * mutable state that's touched by one path but not the other, a
 * mixed five-component page like this is where the contrast would
 * show up.
 *
 * Uses a case-insensitive regex filter on `name`, `brand`, and
 * `articleType` — mirrors the shape `retail-store` uses for its
 * search page so anyone cross-referencing sees a familiar pattern.
 */
export interface ProductsBySearchProps {
  readonly poolMax?: number | undefined;
  readonly query?: string;
  readonly limit?: number;
}

const DEFAULT_QUERY = 'shirt';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function ProductsBySearch({
  poolMax,
  query = DEFAULT_QUERY,
  limit = 10,
}: ProductsBySearchProps) {
  const opts: DbOptions = { poolMax };
  const db = await getDb(opts);

  const regex = new MongoParamRef(new RegExp(escapeRegex(query), 'i'));
  const filter = MongoOrExpr.of([
    MongoFieldFilter.of('name', '$regex', regex),
    MongoFieldFilter.of('brand', '$regex', regex),
    MongoFieldFilter.of('articleType', '$regex', regex),
  ]);

  const plan = db.query.from('products').match(filter).sort({ name: 1 }).limit(limit).build();

  const results: Product[] = [];
  for await (const row of db.runtime.execute(plan)) {
    results.push(row as Product);
  }

  return (
    <div className="card">
      <h2>Products by search (query builder)</h2>
      <p className="muted">
        <code>
          db.query.from('products').match(/{query}/i).limit({limit}).build()
        </code>
      </p>
      {results.length === 0 ? (
        <p className="muted">
          No matches for <code>{query}</code>. Run <code>pnpm seed</code> or try another term.
        </p>
      ) : (
        <ul>
          {results.map((product) => (
            <li key={String(product._id)}>
              <span className="badge">{product.articleType}</span>
              <code>{product.name}</code>
              <span className="muted"> — {product.brand}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
