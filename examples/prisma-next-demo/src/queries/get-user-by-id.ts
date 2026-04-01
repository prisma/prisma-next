import { db } from '../prisma/db';

export async function getUserById(userId: string) {
  return db.sql.user
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .first();
}
