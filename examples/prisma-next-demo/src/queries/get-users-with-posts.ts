import { getRuntime } from '../prisma/runtime';
import type { ResultType } from '@prisma-next/sql-query/types';
import { schema, sql } from '../prisma/query';

export async function getUsersWithPosts(limit: number = 10) {
  const runtime = getRuntime();
  const userTable = schema.tables.user;
  const postTable = schema.tables.post;

  const plan = sql
    .from(userTable)
    .includeMany(
      postTable,
      (on) => on.eqCol(userTable.columns.id, postTable.columns.userId),
      (child) =>
        child
          .select({
            id: postTable.columns.id,
            title: postTable.columns.title,
            createdAt: postTable.columns.createdAt,
          })
          .orderBy(postTable.columns.createdAt.desc()),
      { alias: 'posts' },
    )
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
      posts: true,
    })
    .limit(limit)
    .build();

  type Row = ResultType<typeof plan>;
  const rows: Row[] = [];

  for await (const row of runtime.execute(plan)) {
    rows.push(row);
  }

  return rows;
}
