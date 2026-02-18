import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const kysely = db.kysely(runtime);

  return kysely
    .selectFrom('post')
    .select(['id', 'title', 'userId', 'createdAt', 'embedding'])
    .where('userId', '=', userId)
    .limit(1000)
    .execute();
}
