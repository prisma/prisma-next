import { db } from '../prisma/db';

export async function getUserById(userId: string) {
  const plan = db.sql.user
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .build();
  const rows = await db.runtime().execute(plan);
  return rows[0] ?? null;
}
