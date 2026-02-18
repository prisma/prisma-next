import type { ResultType } from '@prisma-next/contract/types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { collect } from './utils';

export async function ormGetUsersWithPosts(
  limit: number,
  runtime: Runtime,
): Promise<Record<string, unknown>[]> {
  const plan = db.orm
    .user()
    .include.posts((child) =>
      child
        .where((m) => m.id.eq(param('postId')))
        .select((m) => ({
          id: m.id,
          title: m.title,
          createdAt: m.createdAt,
        }))
        .orderBy((m) => m.createdAt.desc()),
    )
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      posts: true,
    }))
    .take(limit)
    .findMany({
      params: { postId: 'post_001' },
    });
  type Row = ResultType<typeof plan>;
  // @ts-expect-error - This is to test the type inference
  type _Test = Row['posts'];
  // @ts-expect-error - This is to test the type inference
  type _Post = Row['posts'][0];

  return collect(runtime.execute(plan));
}
