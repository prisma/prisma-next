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
