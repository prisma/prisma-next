import { generateId } from '@prisma-next/ids/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { executeKyselyTakeFirst, getDemoKysely } from './run';

export async function insertUserTransaction(runtime: Runtime) {
  const userId = generateId({ id: 'uuidv4' });
  const kysely = getDemoKysely();
  const connection = await runtime.connection();

  try {
    await connection
      .execute(
        db.kysely.build(
          kysely.insertInto('user').values({
            id: userId,
            kind: 'user',
            email: 'jane@doe.com',
            createdAt: new Date().toISOString(),
          }),
        ),
      )
      .toArray();

    const transaction = await connection.transaction();
    try {
      await transaction
        .execute(
          db.kysely.build(
            kysely.updateTable('user').set({ email: 'john@doe.com' }).where('id', '=', userId),
          ),
        )
        .toArray();

      throw new Error('Simulated error to trigger rollback');
    } catch (err) {
      await transaction.rollback();
      if ((err as Error).message !== 'Simulated error to trigger rollback') {
        throw err;
      }
    }
  } finally {
    await connection.release();
  }

  return executeKyselyTakeFirst(
    runtime,
    kysely.selectFrom('user').selectAll().where('id', '=', userId),
  );
}
