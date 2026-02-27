import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { getDemoKysely } from './run';

export async function getUsers(runtime: Runtime, limit = 10) {
  const kysely = getDemoKysely();
  const query = kysely.selectFrom('user').select(['id', 'email', 'createdAt', 'kind']).limit(limit);

  return runtime.execute(db.kysely.build(query)).toArray();
}
