import { generateId } from '@prisma-next/ids/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createKysely } from '../prisma/context';

export async function insertUser(email: string, runtime: Runtime) {
  const userId = generateId({ id: 'uuidv4' });
  const kysely = createKysely(runtime);

  const rows = await kysely
    .insertInto('user')
    .values({
      id: userId,
      email,
      kind: 'user',
      createdAt: new Date().toISOString(),
    })
    .returning(['id', 'email'])
    .execute();

  return rows[0] ?? null;
}

export async function updateUser(userId: string, newEmail: string, runtime: Runtime) {
  const kysely = createKysely(runtime);

  const rows = await kysely
    .updateTable('user')
    .set({ email: newEmail })
    .where('id', '=', userId)
    .returning(['id', 'email'])
    .execute();

  return rows[0] ?? null;
}

export async function deleteUser(userId: string, runtime: Runtime) {
  const kysely = createKysely(runtime);

  const rows = await kysely
    .deleteFrom('user')
    .where('id', '=', userId)
    .returning(['id', 'email'])
    .execute();

  return rows[0] ?? null;
}
