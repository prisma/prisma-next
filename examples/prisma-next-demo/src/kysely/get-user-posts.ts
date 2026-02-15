import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type { Runtime } from '@prisma-next/sql-runtime';
import { Kysely } from 'kysely';
import { executionContext } from '../prisma/context';

export async function getUserPosts(userId: string, runtime: Runtime) {
  const contract = executionContext.contract;
  const kysely = new Kysely<KyselifyContract<typeof contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });

  return kysely
    .selectFrom('post')
    .select(['id', 'title', 'userId', 'createdAt', 'embedding'])
    .where('userId', '=', userId)
    .limit(1000)
    .execute();
}
