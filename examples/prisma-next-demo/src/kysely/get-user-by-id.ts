import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type { Runtime } from '@prisma-next/sql-runtime';
import { Kysely } from 'kysely';
import { context } from '../prisma/db';

export async function getUserById(userId: string, runtime: Runtime) {
  const contract = context.contract;
  const kysely = new Kysely<KyselifyContract<typeof contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });

  return kysely
    .selectFrom('user')
    .selectAll()
    .where('id', '=', userId)
    .limit(1)
    .executeTakeFirstOrThrow();
}
