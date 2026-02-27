import type { Runtime } from '@prisma-next/sql-runtime';
import { createKysely } from '../prisma/context';

export async function getUserById(userId: string, runtime: Runtime) {
  const kysely = createKysely(runtime);

  return kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .limit(1)
    .executeTakeFirstOrThrow();
}
