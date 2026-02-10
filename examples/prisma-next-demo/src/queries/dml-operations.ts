import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function insertUser(email: string, runtime: Runtime) {
  const userTable = db.schema.tables.user;
  const userColumns = userTable.columns;

  const plan = db.sql
    .insert(userTable, {
      email: param('email'),
    })
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        email,
      },
    });

  const rows: Array<{ id: number; email: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: number; email: string });
  }

  return rows[0];
}

export async function updateUser(userId: number, newEmail: string, runtime: Runtime) {
  const userTable = db.schema.tables.user;
  const userColumns = userTable.columns;

  const plan = db.sql
    .update(userTable, {
      email: param('newEmail'),
    })
    .where(userColumns.id.eq(param('userId')))
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        newEmail,
        userId,
      },
    });

  const rows: Array<{ id: number; email: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: number; email: string });
  }

  return rows[0];
}

export async function deleteUser(userId: number, runtime: Runtime) {
  const userTable = db.schema.tables.user;
  const userColumns = userTable.columns;

  const plan = db.sql
    .delete(userTable)
    .where(userColumns.id.eq(param('userId')))
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        userId,
      },
    });

  const rows: Array<{ id: number; email: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: number; email: string });
  }

  return rows[0];
}
