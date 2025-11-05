import { param } from '@prisma-next/sql-query/param';
import { getRuntime } from '../prisma/runtime';
import type { ResultType } from '@prisma-next/sql-query/types';
import { schema, sql } from '../prisma/query';

export async function getUserPosts(userId: number) {
  const runtime = getRuntime();
  const postTable = schema.tables.post;

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

  type Row = ResultType<typeof plan>;
  const rows: Row[] = [];

  for await (const row of runtime.execute(plan)) {
    rows.push(row);
  }

  return rows;
}
