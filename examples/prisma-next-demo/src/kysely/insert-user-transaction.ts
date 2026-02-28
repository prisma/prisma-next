import { generateId } from '@prisma-next/ids/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { firstOrNull } from './result-utils';

export async function insertUserTransaction(runtime: Runtime) {
  const kysely = db.kysely;

  const userId = generateId({ id: 'uuidv4' });
  const connection = await runtime.connection();

  try {
    const query = kysely.insertInto('user').values({
      id: userId,
      kind: 'user',
      email: 'jane@doe.com',
      createdAt: new Date().toISOString(),
    });

    await connection.execute(kysely.build(query)).toArray();

    const transaction = await connection.transaction();
    try {
      const query = kysely
        .updateTable('user')
        .set({ email: 'john@doe.com' })
        .where('id', '=', userId);

      await transaction.execute(kysely.build(query)).toArray();

      throw new Error('Simulated error to trigger rollback');
    } catch (err: unknown) {
      await transaction.rollback();
      if (!(err instanceof Error) || err.message !== 'Simulated error to trigger rollback') {
        throw err;
      }
    }
  } finally {
    await connection.release();
  }

  const query = kysely.selectFrom('user').selectAll().where('id', '=', userId);
  return firstOrNull(runtime.execute(kysely.build(query)));
}
