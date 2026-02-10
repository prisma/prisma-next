import type { Runtime } from '@prisma-next/sql-runtime';
import { sql, tables } from '../prisma/db';
import { collect } from './utils';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
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
