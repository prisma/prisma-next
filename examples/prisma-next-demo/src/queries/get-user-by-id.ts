import { param } from '@prisma-next/sql-query/param';
import type { ResultType } from '@prisma-next/sql-query/types';
import { schema, sql } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';

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

  type Row = ResultType<typeof plan>;
  const rows: Row[] = [];

  for await (const row of runtime.execute(plan)) {
    rows.push(row);
  }

  return rows[0] ?? null;
}
