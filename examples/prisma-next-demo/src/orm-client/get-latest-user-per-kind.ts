import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientGetLatestUserPerKind(runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.users
    .orderBy([(user) => user.kind.asc(), (user) => user.createdAt.desc(), (user) => user.id.asc()])
    .distinctOn('kind')
    .select('id', 'email', 'kind', 'createdAt')
    .all()
    .toArray();
}
