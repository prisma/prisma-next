import type { Runtime } from '@prisma-next/sql-runtime';
import { kysely } from '../prisma/db';
import { createOrmClient } from './client';

export async function ormClientGetUsersViaWhereArg(
  kind: 'admin' | 'user',
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.users
    .where(kysely.build(kysely.selectFrom('user').select('id').where('kind', '=', kind).limit(1)))
    .take(limit)
    .all();
}
