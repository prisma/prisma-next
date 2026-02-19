import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientGetAdminUsers(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.users.admins().take(limit).all().toArray();
}
