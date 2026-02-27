import type { Runtime } from '@prisma-next/sql-runtime';
import { createKysely } from '../prisma/context';

export async function getAllPostsUnbounded(runtime: Runtime) {
  const kysely = createKysely(runtime);

  return kysely.selectFrom('post').select(['id', 'title', 'userId', 'createdAt']).execute();
}
