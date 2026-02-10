import type { ResultType } from '@prisma-next/contract/types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { sql, tables } from '../prisma/context';
import { collect } from './utils';

export async function getUserPosts(userId: string, runtime: Runtime) {
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
  // @ts-expect-error - This is to test the type inference
  type _Test = Row['embedding'];

  return collect(runtime.execute(plan));
}
