import type { ResultType } from '@prisma-next/sql-query/types';
import { schema, sql } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';

export async function getUsers(limit = 10) {
  const runtime = getRuntime();
  const userTable = schema.tables.user;

  const plan = sql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
    })
    .limit(limit)
    .build();

  type Row = ResultType<typeof plan>;
  const rows: Row[] = [];

  for await (const row of runtime.execute(plan)) {
    rows.push(row);
  }

  return rows;
}
