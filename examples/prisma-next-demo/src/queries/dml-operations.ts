import { generateId } from '@prisma-next/ids/runtime';
import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { sql, tables } from '../prisma/query';

export async function insertUser(email: string, runtime: Runtime) {
  const userTable = tables.user;
  const userColumns = userTable.columns;
  const userId = generateId({ id: 'uuidv4' });

  const plan = sql
    .insert(userTable, {
      id: param('id'),
      email: param('email'),
    })
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        id: userId,
        email,
      },
    });

  const rows: Array<{ id: string; email: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; email: string });
  }

  return rows[0];
}

export async function updateUser(userId: string, newEmail: string, runtime: Runtime) {
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

  const rows: Array<{ id: string; email: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; email: string });
  }

  return rows[0];
}

export async function deleteUser(userId: string, runtime: Runtime) {
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

  const rows: Array<{ id: string; email: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; email: string });
  }

  return rows[0];
}
