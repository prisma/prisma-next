import type { Runtime } from '@prisma-next/sql-runtime';
import { sql } from '../prisma-no-emit/context';

export async function getUserById(userId: string, runtime: Runtime) {
  const plan = sql.user
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .build();
  const rows = await runtime.execute(plan);
  return rows[0] ?? null;
}
