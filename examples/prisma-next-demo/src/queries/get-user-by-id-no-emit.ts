import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';
import { firstOrNull } from '../result-utils';

export async function getUserById(userId: string, runtime: Runtime) {
  const userTable = sql['user'];
  if (!userTable) {
    throw new Error('Missing user table in no-emit context');
  }

  const plan = userTable
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .build();

  return firstOrNull(runtime.execute(plan));
}
