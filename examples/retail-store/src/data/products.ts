import type { FieldOutputTypes } from '../contract';
import type { Db } from '../db';
import { collectResults } from './execute-raw';
import { objectIdEq } from './object-id-filter';

type Product = FieldOutputTypes['Product'];

export function findProducts(db: Db) {
  return db.orm.products.all();
}

export function findProductById(db: Db, id: string) {
  return db.orm.products.where(objectIdEq('_id', id)).first();
}

export async function getRandomProducts(db: Db, count: number): Promise<Product[]> {
  const plan = db.pipeline.from('products').sample(count).build();
  return collectResults<Product>(db, plan);
}

/**
 * Vector similarity search via $vectorSearch aggregation stage.
 * Requires an Atlas cluster with a vector search index on the
 * `products.embedding` field. Not available with mongodb-memory-server.
 *
 * Uses raw aggregate instead of the pipeline builder because $vectorSearch
 * is an Atlas-specific stage not yet supported by the pipeline builder API.
 */
export async function findSimilarProducts(
  db: Db,
  embedding: number[],
  limit: number,
): Promise<Product[]> {
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
  return collectResults<Product>(db, plan);
}
