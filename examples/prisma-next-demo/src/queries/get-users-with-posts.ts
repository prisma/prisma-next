import { schema, sql } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

export async function getUsersWithPosts(limit = 10) {
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

  return collect(runtime.execute(plan));
}
