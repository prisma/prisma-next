import type { Runtime } from '@prisma-next/sql-runtime';
import { createKysely } from '../prisma/context';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const kysely = createKysely(runtime);

  const users = await kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .limit(limit)
    .execute();

  const result = [];
  for (const user of users) {
    const posts = await kysely
      .selectFrom('post')
      .select(['id', 'title', 'createdAt'])
      .where('userId', '=', user.id)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .execute();
    result.push({ ...user, posts });
  }
  return result;
}
