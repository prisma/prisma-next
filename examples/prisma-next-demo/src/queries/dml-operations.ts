import { param } from '@prisma-next/sql-relational-core/param';
import { sql, tables } from '../prisma/query.ts';
import { getRuntime } from '../prisma/runtime.ts';

export async function insertUser(email: string) {
  const runtime = getRuntime();
  const userTable = tables.user;
  const userColumns = userTable.columns;

  const plan = sql
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

export async function updateUser(userId: number, newEmail: string) {
  const runtime = getRuntime();
  const userTable = tables.user;
  const userColumns = userTable.columns;

  const plan = sql
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

export async function deleteUser(userId: number) {
  const runtime = getRuntime();
  const userTable = tables.user;
  const userColumns = userTable.columns;

  const plan = sql
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
