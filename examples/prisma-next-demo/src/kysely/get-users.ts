import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUsers(runtime: Runtime, limit = 10) {
  const kysely = db.kysely(runtime);

  return kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt', 'kind'])
    .limit(limit)
    .execute();
}
