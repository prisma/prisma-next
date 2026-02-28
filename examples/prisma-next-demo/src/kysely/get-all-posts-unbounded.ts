import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getAllPostsUnbounded(runtime: Runtime) {
  const kysely = db.kysely;

  const query = kysely.selectFrom('post').select(['id', 'title', 'userId', 'createdAt']);

  return runtime.execute(kysely.build(query)).toArray();
}
