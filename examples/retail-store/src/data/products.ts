import type { Db } from '../db';
import { objectIdEq } from './object-id-filter';

export function findProducts(db: Db) {
  return db.orm.products.all();
}

export function findProductById(db: Db, id: string) {
  return db.orm.products.where(objectIdEq('_id', id)).first();
}

export async function getRandomProducts(db: Db, count: number) {
  const plan = db.pipeline.from('products').sample(count).build();

  const results: unknown[] = [];
  for await (const row of db.runtime.execute(plan)) {
    results.push(row);
  }
  return results;
}

/**
 * Vector similarity search via $vectorSearch aggregation stage.
 * Requires an Atlas cluster with a vector search index on the
 * `products.embedding` field. Not available with mongodb-memory-server.
 */
export async function findSimilarProducts(db: Db, embedding: number[], limit: number) {
  const plan = db.raw
    .collection('products')
    .aggregate([
      {
        $vectorSearch: {
          index: 'product_embedding_index',
          path: 'embedding',
          queryVector: embedding,
          numCandidates: limit * 10,
          limit,
        },
      },
    ])
    .build();

  const results: unknown[] = [];
  for await (const row of db.runtime.execute(plan)) {
    results.push(row);
  }
  return results;
}
