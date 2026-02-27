import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUserById(userId: string, runtime: Runtime) {
  const kysely = db.kysely(runtime);

  return kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1)
    .executeTakeFirstOrThrow();
}
