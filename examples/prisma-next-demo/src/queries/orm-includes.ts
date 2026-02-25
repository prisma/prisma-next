import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { collect } from './utils';

export async function ormGetUsersWithPosts(
  limit: number,
  runtime: Runtime,
): Promise<Record<string, unknown>[]> {
  const userTable = db.schema.tables.user;
  const postTable = db.schema.tables.post;

  const plan = db.sql
    .from(userTable)
    .includeMany(
      postTable,
      (on) => on.eqCol(userTable.columns.id, postTable.columns.userId),
      (child) =>
        child
          .where(postTable.columns.id.eq(param('postId')))
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
    .build({ params: { postId: 'post_001' } });

  return collect(runtime.execute(plan));
}
