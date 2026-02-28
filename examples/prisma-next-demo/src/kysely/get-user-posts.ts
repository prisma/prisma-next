import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const kysely = db.kysely;
  const query = kysely
    .selectFrom('post')
    .select(['id', 'title', 'userId', 'createdAt', 'embedding'])
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(1000);

  return runtime.execute(kysely.build(query)).toArray();
}
