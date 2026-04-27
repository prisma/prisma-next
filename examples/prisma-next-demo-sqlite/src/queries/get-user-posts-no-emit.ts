import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';

export async function getUserPosts(userId: string, runtime: Runtime) {
  return runtime.execute(
    sql.post
      .select('id', 'title', 'userId', 'createdAt')
      .where((f, fns) => fns.eq(f.userId, userId))
      .limit(100)
      .build(),
  );
}
