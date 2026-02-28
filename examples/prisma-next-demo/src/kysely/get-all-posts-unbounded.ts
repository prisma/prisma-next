import type { Runtime } from '@prisma-next/sql-runtime';
import { kysely } from '../prisma/db';

export async function getAllPostsUnbounded(runtime: Runtime) {
  const query = kysely.selectFrom('post').select(['id', 'title', 'userId', 'createdAt']);

  return runtime.execute(kysely.build(query)).toArray();
}
