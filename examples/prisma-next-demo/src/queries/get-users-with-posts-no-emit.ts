import { sql, tables } from '../prisma/query-no-emit.ts';
import { getRuntime } from '../prisma/runtime-no-emit.ts';
import { collect } from './utils.ts';

export async function getUsersWithPosts(limit = 10) {
  const runtime = getRuntime();
  const userTable = tables.user;
  const postTable = tables.post;

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

  return collect(runtime.execute(plan));
}
