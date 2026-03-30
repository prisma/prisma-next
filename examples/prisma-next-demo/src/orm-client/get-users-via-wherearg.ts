import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUsersViaWhereArg(
  kind: 'admin' | 'user',
  limit: number,
  runtime: Runtime,
) {
  const orm = createOrmClient(runtime);

  return orm.User.where({ kind }).take(limit).all();
}
