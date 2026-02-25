import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { executeKyselyQuery } from './run';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const users = await executeKyselyQuery<
    Record<string, unknown> & { id: string; email: string; createdAt: string }
  >(runtime, db.kysely.selectFrom('user').select(['id', 'email', 'createdAt']).limit(limit));

  const result = [];
  for (const user of users) {
    const posts = await executeKyselyQuery(
      runtime,
      db.kysely
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
