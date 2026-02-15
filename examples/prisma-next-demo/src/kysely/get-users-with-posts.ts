import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type { Runtime } from '@prisma-next/sql-runtime';
import { Kysely } from 'kysely';
import { executionContext } from '../prisma/context';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const contract = executionContext.contract;
  const kysely = new Kysely<KyselifyContract<typeof contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });

  const users = await kysely
    .selectFrom('user')
    .select(['id', 'email', 'createdAt'])
    .limit(limit)
    .execute();

  const result = [];
  for (const user of users) {
    const posts = await kysely
      .selectFrom('post')
      .select(['id', 'title', 'createdAt'])
      .where('userId', '=', user.id)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .execute();
    result.push({ ...user, posts });
  }
  return result;
}
