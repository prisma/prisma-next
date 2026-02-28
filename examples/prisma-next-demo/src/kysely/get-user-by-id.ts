import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { firstOrThrow } from '../result-utils';

export async function getUserById(userId: string, runtime: Runtime) {
  const query = db.kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1);

  return firstOrThrow(runtime.execute(db.kysely.build(query)));
}
