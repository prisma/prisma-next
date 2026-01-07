import { sql, tables } from '../prisma/query-no-emit.ts';
import { getRuntime } from '../prisma/runtime-no-emit.ts';
import { collect } from './utils.ts';

export async function getUsers(limit = 10) {
  const runtime = getRuntime();
  const userTable = tables.user;

  const plan = sql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
    })
    .limit(limit)
    .build();

  return collect(runtime.execute(plan));
}
