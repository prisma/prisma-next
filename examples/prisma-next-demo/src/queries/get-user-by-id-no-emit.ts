import type { Runtime } from '@prisma-next/sql-runtime';
import { createSql } from '../prisma-no-emit/context';
import { collect } from './utils';

export async function getUserById(userId: string, runtime: Runtime) {
  const db = createSql();
  const plan = db.user
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .build();
  const rows = await collect(runtime.execute(plan));
  return rows[0] ?? null;
}
