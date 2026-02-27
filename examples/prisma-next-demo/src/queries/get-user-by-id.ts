import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

export async function getUserById(userId: string, runtime: Runtime) {
  const userTable = demoSchema.tables.user;

  const plan = demoSql
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
