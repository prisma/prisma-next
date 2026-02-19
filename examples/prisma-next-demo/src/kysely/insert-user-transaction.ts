import { generateId } from '@prisma-next/ids/runtime';
import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type { Runtime } from '@prisma-next/sql-runtime';
import { Kysely } from 'kysely';
import { db } from '../prisma/db';

export async function insertUserTransaction(runtime: Runtime) {
  const userId = generateId({ id: 'uuidv4' });
  const contract = db.context.contract;
  const kysely = new Kysely<KyselifyContract<typeof contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });

  await kysely
    .insertInto('user')
    .values({
      id: userId,
      kind: 'user',
      email: 'jane@doe.com',
      createdAt: new Date(),
    })
    .execute();

  await kysely
    .transaction()
    .execute(async (trx) => {
      await trx
        .updateTable('user')
        .set({ email: 'john@doe.com' })
        .where('id', '=', userId)
        .execute();

      throw new Error('Simulated error to trigger rollback');
    })
    .catch((err) => {
      if (err.message !== 'Simulated error to trigger rollback') {
        // Ignore error
        throw err;
      }
    });

  return kysely.selectFrom('user').selectAll().where('id', '=', userId).executeTakeFirst();
}
