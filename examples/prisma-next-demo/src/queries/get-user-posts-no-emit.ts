import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const postTable = sql['post'];
  if (!postTable) {
    throw new Error('Missing post table in no-emit context');
  }

  const plan = postTable
    .select('id', 'title', 'userId', 'createdAt')
    .where((f, fns) => fns.eq(f.userId, userId))
    .limit(100)
    .build();
  return runtime.execute(plan);
}
