import type { Runtime } from '@prisma-next/sql-runtime';
import { executeKyselyQuery, getDemoKysely } from './run';

export async function getUsers(runtime: Runtime, limit = 10) {
  const kysely = getDemoKysely();
  const query = kysely.selectFrom('user').select(['id', 'email', 'createdAt', 'kind']).limit(limit);

  return executeKyselyQuery(runtime, query);
}
