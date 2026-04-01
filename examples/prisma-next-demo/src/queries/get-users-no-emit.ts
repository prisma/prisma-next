import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';

export async function getUsers(runtime: Runtime, limit = 10) {
  const userTable = sql['user'];
  if (!userTable) {
    throw new Error('Missing user table in no-emit context');
  }

  const plan = userTable.select('id', 'email', 'createdAt').limit(limit).build();
  return runtime.execute(plan);
}
