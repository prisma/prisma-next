import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUsers(runtime: Runtime, limit = 10) {
  const query = db.kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt', 'kind'])
    .limit(limit);

  return runtime.execute(db.kysely.build(query)).toArray();
}
