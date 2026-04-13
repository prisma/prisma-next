import type { Db } from '../db';

export function findUsers(db: Db) {
  return db.orm.users.all();
}

export function findUserById(db: Db, id: string) {
  return db.orm.users.where({ _id: id }).first();
}

export function createUser(db: Db, data: { name: string; email: string; address: null }) {
  return db.orm.users.create(data);
}
