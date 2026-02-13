import type { Runtime } from '@prisma-next/sql-runtime';
import { createRepositoryClient } from './client';

export async function repositoryGetUserPosts(userId: string, limit: number, runtime: Runtime) {
  const db = createRepositoryClient(runtime);
  return db.posts
    .forUser(userId)
    .orderBy(() => ({ column: 'createdAt', direction: 'desc' }))
    .take(limit)
    .findMany()
    .toArray();
}
