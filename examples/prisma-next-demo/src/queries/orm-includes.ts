import { param } from '@prisma-next/sql-query/param';
import { orm } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

export async function ormGetUsersWithPosts(limit = 10) {
  const runtime = getRuntime();

  const plan = orm
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
      posts: u.posts,
    }))
    .take(limit)
    .findMany({
      params: { postId: 1 },
    });

  return collect(runtime.execute(plan));
}
