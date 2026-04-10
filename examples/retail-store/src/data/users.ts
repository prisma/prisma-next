import type { Db } from '../db';
import { objectIdEq } from './object-id-filter';

export function findUsers(db: Db) {
  return db.orm.users.all();
}

export function findUserById(db: Db, id: string) {
  return db.orm.users.where(objectIdEq('_id', id)).first();
}

export function createUser(db: Db, data: { name: string; email: string; address: null }) {
  return db.orm.users.create(data);
}
