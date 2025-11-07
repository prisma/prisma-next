import { param } from '@prisma-next/sql-query/param';
import { schema, sql } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

export async function getUserById(userId: number) {
  const runtime = getRuntime();
  const userTable = schema.tables.user;

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
