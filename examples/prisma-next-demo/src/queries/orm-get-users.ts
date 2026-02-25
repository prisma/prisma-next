import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { collect } from './utils';

export async function ormGetUsers(limit: number, runtime: Runtime) {
  const userTable = db.schema.tables.user;

  const plan = db.sql
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
