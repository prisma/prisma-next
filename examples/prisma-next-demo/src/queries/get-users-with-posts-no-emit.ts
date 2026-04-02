import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const userTable = sql['user'];
  const postTable = sql['post'];
  if (!userTable || !postTable) {
    throw new Error('Missing user or post query builder in no-emit context');
  }

  const users = await runtime.execute(
    userTable.select('id', 'email', 'createdAt').limit(limit).build(),
  );

  return Promise.all(
    users.map(async (user) => {
      const posts = await runtime.execute(
        postTable
          .select('id', 'title', 'createdAt')
          .where((f, fns) => fns.eq(f.userId, user.id))
          .orderBy('createdAt', { direction: 'desc' })
          .build(),
      );

      return {
        ...user,
        posts,
      };
    }),
  );
}
