import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUserPosts(userId: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.forUser(userId)
    .orderBy((post) => post.createdAt.desc())
    .take(limit)
    .all();
}
