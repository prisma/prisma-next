import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { executeKyselyQuery } from './run';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const query = db.kysely
    .selectFrom('post')
    .select(['id', 'title', 'userId', 'createdAt', 'embedding'])
    .where('userId', '=', userId)
    .limit(1000);

  return executeKyselyQuery(runtime, query);
}
