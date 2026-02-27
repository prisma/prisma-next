import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function getAllPostsUnbounded(runtime: Runtime) {
  const query = db.kysely.selectFrom('post').select(['id', 'title', 'userId', 'createdAt']);

  return runtime.execute(db.kysely.build(query)).toArray();
}
