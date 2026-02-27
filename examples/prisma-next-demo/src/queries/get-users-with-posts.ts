import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const userTable = demoSchema.tables.user;
  const postTable = demoSchema.tables.post;

  const plan = demoSql
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
