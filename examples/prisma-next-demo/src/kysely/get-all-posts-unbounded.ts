import type { Runtime } from '@prisma-next/sql-runtime';
import { executeKyselyQuery, getDemoKysely } from './run';

export async function getAllPostsUnbounded(runtime: Runtime) {
  const kysely = getDemoKysely();
  const query = kysely.selectFrom('post').select(['id', 'title', 'userId', 'createdAt']);

  return executeKyselyQuery(runtime, query);
}
