import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { executeKyselyQuery } from './run';

export async function getAllPostsUnbounded(runtime: Runtime) {
  const query = db.kysely.selectFrom('post').select(['id', 'title', 'userId', 'createdAt']);

  return executeKyselyQuery(runtime, query);
}
