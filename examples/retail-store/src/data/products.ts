import { MongoFieldFilter, MongoOrExpr } from '@prisma-next/mongo-query-ast/execution';
import { MongoParamRef } from '@prisma-next/mongo-value';
import type { FieldOutputTypes } from '../contract';
import type { Db } from '../db';
import { collectResults } from './execute-raw';

type Product = FieldOutputTypes['Product'];

export function findProducts(db: Db) {
  return db.orm.products.all();
}

export async function findProductsPaginated(
  db: Db,
  skip: number,
  take: number,
): Promise<Product[]> {
  const plan = db.query.from('products').sort({ _id: 1 }).skip(skip).limit(take).build();
  return collectResults<Product>(db, plan);
}

export function findProductById(db: Db, id: string) {
  return db.orm.products.where({ _id: id }).first();
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchProducts(db: Db, query: string): Promise<Product[]> {
  const regex = new MongoParamRef(new RegExp(escapeRegex(query), 'i'));
  const filter = MongoOrExpr.of([
    MongoFieldFilter.of('name', '$regex', regex),
    MongoFieldFilter.of('brand', '$regex', regex),
    MongoFieldFilter.of('articleType', '$regex', regex),
  ]);
  const plan = db.query.from('products').match(filter).build();
  return collectResults<Product>(db, plan);
}

export async function getRandomProducts(db: Db, count: number): Promise<Product[]> {
  const plan = db.query.from('products').sample(count).build();
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
