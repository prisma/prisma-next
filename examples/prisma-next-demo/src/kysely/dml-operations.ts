import { generateId } from '@prisma-next/ids/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { kysely } from '../prisma/db';
import { firstOrNull } from './result-utils';

export async function insertUser(email: string, runtime: Runtime) {
  const userId = generateId({ id: 'uuidv4' });

  const query = kysely
    .insertInto('user')
    .values({
      id: userId,
      email,
      kind: 'user',
      createdAt: new Date().toISOString(),
    })
    .returning(['id', 'email']);

  return firstOrNull(runtime.execute(kysely.build(query)));
}

export async function updateUser(userId: string, newEmail: string, runtime: Runtime) {
  const query = kysely
    .updateTable('user')
    .set({ email: newEmail })
    .where('id', '=', userId)
    .returning(['id', 'email']);

  return firstOrNull(runtime.execute(kysely.build(query)));
}

export async function deleteUser(userId: string, runtime: Runtime) {
  const query = kysely.deleteFrom('user').where('id', '=', userId).returning(['id', 'email']);

  return firstOrNull(runtime.execute(kysely.build(query)));
}
