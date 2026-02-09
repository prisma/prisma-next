import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { sql, tables } from '../prisma-no-emit/context';
import { collect } from './utils';

export async function getUserById(userId: number, runtime: Runtime) {
  const userTable = tables.user;

  const plan = sql
    .from(userTable)
    .where(userTable.columns.id.eq(param('userId')))
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
    })
    .limit(1)
    .build({ params: { userId } });

  const rows = await collect(runtime.execute(plan));
  return rows[0] ?? null;
}
