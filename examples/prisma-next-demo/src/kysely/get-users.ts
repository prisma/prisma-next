import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type { Runtime } from '@prisma-next/sql-runtime';
import { Kysely } from 'kysely';
import { executionContext } from '../prisma/context';

export async function getUsers(runtime: Runtime, limit = 10) {
  const contract = executionContext.contract;
  const kysely = new Kysely<KyselifyContract<typeof contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });

  return kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt', 'kind'])
    .limit(limit)
    .execute();
}
