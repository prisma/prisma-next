import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

export async function ormGetUsers(limit: number, runtime: Runtime) {
  const userTable = demoSchema.tables.user;

  const plan = demoSql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
      kind: userTable.columns.kind,
    })
    .orderBy(userTable.columns.createdAt.desc())
    .limit(limit)
    .build();

  return collect(runtime.execute(plan));
}
