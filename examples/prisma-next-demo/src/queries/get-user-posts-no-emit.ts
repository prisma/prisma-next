import type { Runtime } from '@prisma-next/sql-runtime';
import { createSql } from '../prisma-no-emit/context';
import { collect } from './utils';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const db = createSql();
  const plan = db.post
    .select('id', 'title', 'userId', 'createdAt')
    .where((f, fns) => fns.eq(f.userId, userId))
    .limit(100)
    .build();
  return collect(runtime.execute(plan));
}
