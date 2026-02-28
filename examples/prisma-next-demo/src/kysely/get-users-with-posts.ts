import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const usersQuery = db.kysely.selectFrom('user').select(['id', 'email', 'createdAt']).limit(limit);

  const users = await runtime.execute(db.kysely.build(usersQuery)).toArray();

  const result = [];
  for (const user of users) {
    const postsQuery = db.kysely
      .selectFrom('post')
      .select(['id', 'title', 'createdAt'])
      .where('userId', '=', user['id'])
      .orderBy('createdAt', 'desc')
      .limit(100);

    const posts = await runtime.execute(db.kysely.build(postsQuery)).toArray();
    result.push({ ...user, posts });
  }
  return result;
}
