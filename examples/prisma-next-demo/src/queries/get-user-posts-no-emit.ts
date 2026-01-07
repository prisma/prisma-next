import { param } from '@prisma-next/sql-relational-core/param';
import { sql, tables } from '../prisma/query-no-emit.ts';
import { getRuntime } from '../prisma/runtime-no-emit.ts';
import { collect } from './utils.ts';

export async function getUserPosts(userId: number) {
  const runtime = getRuntime();
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
