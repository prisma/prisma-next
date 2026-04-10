import type { Db } from '../db';
import { objectIdEq } from './object-id-filter';

export function findProducts(db: Db) {
  return db.orm.products.all();
}

export function findProductById(db: Db, id: string) {
  return db.orm.products.where(objectIdEq('_id', id)).first();
}
