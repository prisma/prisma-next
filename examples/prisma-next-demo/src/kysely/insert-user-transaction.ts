import { generateId } from '@prisma-next/ids/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

export async function insertUserTransaction(runtime: Runtime) {
  const userId = generateId({ id: 'uuidv4' });
  const connection = await runtime.connection();

  try {
    await connection
      .execute(
        db.kysely.build(
          db.kysely.insertInto('user').values({
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
            db.kysely.updateTable('user').set({ email: 'john@doe.com' }).where('id', '=', userId),
          ),
        )
        .toArray();

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

  const rows = await runtime
    .execute(db.kysely.build(db.kysely.selectFrom('user').selectAll().where('id', '=', userId)))
    .toArray();
  return rows[0] ?? null;
}
