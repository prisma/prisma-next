import type { Runtime } from '@prisma-next/sql-runtime';
import { createSql } from '../prisma-no-emit/context';

export async function getUserById(userId: string, runtime: Runtime) {
  const db = createSql(runtime);
  return db.user
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .first();
}
