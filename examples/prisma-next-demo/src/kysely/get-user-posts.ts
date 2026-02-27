import type { Runtime } from '@prisma-next/sql-runtime';
import { createKysely } from '../prisma/context';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const kysely = createKysely(runtime);

  return kysely
    .selectFrom('post')
    .select(['id', 'title', 'userId', 'createdAt', 'embedding'])
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(1000)
    .execute();
}
