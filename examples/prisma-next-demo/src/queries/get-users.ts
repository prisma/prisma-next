import { schema, sql } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

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

  return collect(runtime.execute(plan));
}
