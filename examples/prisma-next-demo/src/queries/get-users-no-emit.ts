import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';

export async function getUsers(runtime: Runtime, limit = 10) {
  const plan = sql.user.select('id', 'email', 'createdAt').limit(limit).build();
  return runtime.execute(plan);
}
