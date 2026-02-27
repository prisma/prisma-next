import type { Runtime } from '@prisma-next/sql-runtime';
import { createKysely } from '../prisma/context';

export async function getUsers(runtime: Runtime, limit = 10) {
  const kysely = createKysely(runtime);

  return kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt', 'kind'])
    .limit(limit)
    .execute();
}
