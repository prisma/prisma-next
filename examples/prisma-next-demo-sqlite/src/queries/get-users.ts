import { db } from '../prisma/db';

export async function getUsers(limit = 10) {
  const plan = db.sql.user.select('id', 'email', 'createdAt', 'kind').limit(limit).build();
  return db.runtime().execute(plan);
}
