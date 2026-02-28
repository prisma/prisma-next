import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUserById(userId: string, runtime: Runtime) {
  const kysely = db.kysely;

  const query = kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1);

  const rows = await runtime.execute(kysely.build(query)).toArray();
  const user = rows[0];
  if (!user) {
    throw new Error('Expected at least one row');
  }
  return user;
}
