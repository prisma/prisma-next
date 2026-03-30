import { db } from '../prisma/db';

export async function insertUser(email: string) {
  await db.sql.user.insert({ email }).first();
  // Query back the inserted user since returning() requires sql.returning capability
  return db.sql.user
    .select('id', 'email')
    .where((f, fns) => fns.eq(f.email, email))
    .first();
}

export async function updateUser(userId: string, newEmail: string) {
  await db.sql.user
    .update({ email: newEmail })
    .where((f, fns) => fns.eq(f.id, userId))
    .first();
  return db.sql.user
    .select('id', 'email')
    .where((f, fns) => fns.eq(f.id, userId))
    .first();
}

export async function deleteUser(userId: string) {
  const user = await db.sql.user
    .select('id', 'email')
    .where((f, fns) => fns.eq(f.id, userId))
    .first();
  await db.sql.user
    .delete()
    .where((f, fns) => fns.eq(f.id, userId))
    .first();
  return user;
}
