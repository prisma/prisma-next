import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from '../prisma-no-emit/context';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const db = createOrmClient(runtime);
  const publicNs = db['public'];
  if (!publicNs) throw new Error("ORM client is missing the 'public' namespace");
  return publicNs.User.select('id', 'email', 'createdAt')
    .include('posts', (post) =>
      post.orderBy((p) => p.createdAt.desc()).select('id', 'title', 'createdAt'),
    )
    .take(limit)
    .all();
}
