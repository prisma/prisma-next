import type { ResultType } from '@prisma-next/contract';
import { param } from '@prisma-next/sql-relational-core/param';
import { sql, tables } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

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
      embedding: postTable.columns.embedding,
    })
    .build({ params: { userId } });

  type Row = ResultType<typeof plan>;
  // @ts-expect-error - Type-level test to verify embedding type inference
  type _embedding = Row['embedding'];

  return collect(runtime.execute(plan));
}
