import type { Runtime } from '@prisma-next/sql-runtime';
import { executeKyselyTakeFirstOrThrow, getDemoKysely } from './run';

export async function getUserById(userId: string, runtime: Runtime) {
  const kysely = getDemoKysely();
  const query = kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1);

  return executeKyselyTakeFirstOrThrow(runtime, query);
}
