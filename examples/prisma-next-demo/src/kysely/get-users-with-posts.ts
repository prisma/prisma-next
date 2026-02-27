import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const users = await runtime
    .execute(
      db.kysely.build(
        db.kysely.selectFrom('user').select(['id', 'email', 'createdAt']).limit(limit),
      ),
    )
    .toArray();

  const result = [];
  for (const user of users) {
    const posts = await runtime
      .execute(
        db.kysely.build(
          db.kysely
            .selectFrom('post')
            .select(['id', 'title', 'createdAt'])
            .where('userId', '=', user.id)
            .orderBy('createdAt', 'desc')
            .limit(100),
        ),
      )
      .toArray();
    result.push({ ...user, posts });
  }
  return result;
}
