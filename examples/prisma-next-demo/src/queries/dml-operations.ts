import { db } from '../prisma/db';

export async function insertUser(email: string) {
  return db.sql.user.insert({ email }).returning('id', 'email').first();
}

export async function updateUser(userId: string, newEmail: string) {
  return db.sql.user
    .update({ email: newEmail })
    .where((f, fns) => fns.eq(f.id, userId))
    .returning('id', 'email')
    .first();
}

export async function deleteUser(userId: string) {
  return db.sql.user
    .delete()
    .where((f, fns) => fns.eq(f.id, userId))
    .returning('id', 'email')
    .first();
}
