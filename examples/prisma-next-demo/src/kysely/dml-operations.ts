import { generateId } from '@prisma-next/ids/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { getDemoKysely } from './run';

export async function insertUser(email: string, runtime: Runtime) {
  const userId = generateId({ id: 'uuidv4' });
  const kysely = getDemoKysely();
  const query = kysely
    .insertInto('user')
    .values({
      id: userId,
      email,
      kind: 'user',
      createdAt: new Date().toISOString(),
    })
    .returning(['id', 'email']);

  const rows = await runtime.execute(db.kysely.build(query)).toArray();
  return rows[0] ?? null;
}

export async function updateUser(userId: string, newEmail: string, runtime: Runtime) {
  const kysely = getDemoKysely();
  const query = kysely
    .updateTable('user')
    .set({ email: newEmail })
    .where('id', '=', userId)
    .returning(['id', 'email']);

  const rows = await runtime.execute(db.kysely.build(query)).toArray();
  return rows[0] ?? null;
}

export async function deleteUser(userId: string, runtime: Runtime) {
  const kysely = getDemoKysely();
  const query = kysely.deleteFrom('user').where('id', '=', userId).returning(['id', 'email']);

  const rows = await runtime.execute(db.kysely.build(query)).toArray();
  return rows[0] ?? null;
}
