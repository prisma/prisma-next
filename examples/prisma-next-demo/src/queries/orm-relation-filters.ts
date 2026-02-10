import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/db';
import { collect } from './utils';

export async function ormGetUsersWithPosts(runtime: Runtime) {
  const plan = orm
    .user()
    .where.related.posts.some((p) => p.where((m) => m.id.eq(param('postId'))))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .take(100)
    .findMany({
      params: { postId: 'post_001' },
    });

  return collect(runtime.execute(plan));
}

export async function ormGetUsersWithoutPosts(runtime: Runtime) {
  const plan = orm
    .user()
    .where.related.posts.none((p) => p.where((m) => m.id.eq(param('postId'))))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .take(100)
    .findMany({
      params: { postId: 'post_001' },
    });

  return collect(runtime.execute(plan));
}

export async function ormGetUsersWhereAllPostsMatch(runtime: Runtime) {
  const plan = orm
    .user()
    .where.related.posts.every((p) => p.where((m) => m.userId.eq(param('userId'))))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .take(100)
    .findMany({
      params: { userId: 'user_001' },
    });

  return collect(runtime.execute(plan));
}
