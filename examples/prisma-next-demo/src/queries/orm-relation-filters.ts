import { param } from '@prisma-next/sql-relational-core/param';
import { orm } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

export async function ormGetUsersWithPosts() {
  const runtime = getRuntime();

  const plan = orm
    .user()
    .where.related.posts.some((p) => p.where((m) => m.id.eq(param('postId'))))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .findMany({
      params: { postId: 1 },
    });

  return collect(runtime.execute(plan));
}

export async function ormGetUsersWithoutPosts() {
  const runtime = getRuntime();

  const plan = orm
    .user()
    .where.related.posts.none((p) => p.where((m) => m.id.eq(param('postId'))))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .findMany({
      params: { postId: 1 },
    });

  return collect(runtime.execute(plan));
}

export async function ormGetUsersWhereAllPostsMatch() {
  const runtime = getRuntime();

  const plan = orm
    .user()
    .where.related.posts.every((p) => p.where((m) => m.userId.eq(param('userId'))))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .findMany({
      params: { userId: 1 },
    });

  return collect(runtime.execute(plan));
}
