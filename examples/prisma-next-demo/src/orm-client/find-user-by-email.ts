import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientFindUserByEmail(email: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.users.byEmail(email).first();
}
