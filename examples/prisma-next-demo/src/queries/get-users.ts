import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

export async function getUsers(runtime: Runtime, limit = 10) {
  const userTable = demoSchema.tables.user;

  const plan = demoSql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
      kind: userTable.columns.kind,
    })
    .limit(limit)
    .build();

  return collect(runtime.execute(plan));
}
