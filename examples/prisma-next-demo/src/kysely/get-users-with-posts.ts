import type { Runtime } from '@prisma-next/sql-runtime';
import { executeKyselyQuery, getDemoKysely } from './run';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const kysely = getDemoKysely();
  const users = await executeKyselyQuery<
    Record<string, unknown> & { id: string; email: string; createdAt: string }
  >(runtime, kysely.selectFrom('user').select(['id', 'email', 'createdAt']).limit(limit));

  const result = [];
  for (const user of users) {
    const posts = await executeKyselyQuery(
      runtime,
      kysely
        .selectFrom('post')
        .select(['id', 'title', 'createdAt'])
        .where('userId', '=', user.id)
        .orderBy('createdAt', 'desc')
        .limit(100),
    );
    result.push({ ...user, posts });
  }
  return result;
}
