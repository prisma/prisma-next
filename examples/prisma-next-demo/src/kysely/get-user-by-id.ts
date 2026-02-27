import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { getDemoKysely } from './run';

export async function getUserById(userId: string, runtime: Runtime) {
  const kysely = getDemoKysely();
  const query = kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1);

  const plan = db.kysely.build(query);
  const rows = await runtime.execute(plan).toArray();
  const user = rows[0];
  if (!user) {
    throw new Error('Expected at least one row');
  }
  return user;
}
