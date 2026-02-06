import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { sql, tables } from '../prisma-no-emit/query-no-emit';
import { collect } from './utils';

export async function getUserPosts(userId: number, runtime: Runtime) {
  const postTable = tables.post;

  const plan = sql
    .from(postTable)
    .where(postTable.columns.userId.eq(param('userId')))
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      userId: postTable.columns.userId,
      createdAt: postTable.columns.createdAt,
    })
    .build({ params: { userId } });

  return collect(runtime.execute(plan));
}
