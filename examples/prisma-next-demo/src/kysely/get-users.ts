import type { Runtime } from '@prisma-next/sql-runtime';
import { kysely } from '../prisma/db';

export async function getUsers(runtime: Runtime, limit = 10) {
  const query = kysely.selectFrom('user').select(['id', 'email', 'createdAt', 'kind']).limit(limit);

  return runtime.execute(kysely.build(query)).toArray();
}
