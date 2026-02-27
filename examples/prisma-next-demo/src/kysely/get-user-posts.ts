import type { Runtime } from '@prisma-next/sql-runtime';
import { executeKyselyQuery, getDemoKysely } from './run';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const kysely = getDemoKysely();
  const query = kysely
    .selectFrom('post')
    .select(['id', 'title', 'userId', 'createdAt', 'embedding'])
    .where('userId', '=', userId)
    .limit(1000);

  return executeKyselyQuery(runtime, query);
}
