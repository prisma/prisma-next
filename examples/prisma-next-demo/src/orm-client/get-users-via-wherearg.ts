import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { createOrmClient } from './client';

export async function ormClientGetUsersViaWhereArg(
  kind: 'admin' | 'user',
  limit: number,
  runtime: Runtime,
) {
  const orm = createOrmClient(runtime);
  return orm.users
    .where(
      db.kysely.build(db.kysely.selectFrom('user').select('id').where('kind', '=', kind).limit(1)),
    )
    .take(limit)
    .all();
}
