import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { executeKyselyTakeFirstOrThrow } from './run';

export async function getUserById(userId: string, runtime: Runtime) {
  const query = db.kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1);

  return executeKyselyTakeFirstOrThrow(runtime, query);
}
