import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientGetPostFeed(titleTerm: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.posts
    .withTitle(titleTerm)
    .select('id', 'title', 'userId', 'createdAt')
    .include('user', (user) => user.select('id', 'email', 'kind'))
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.asc()])
    .take(limit)
    .all()
    .toArray();
}
