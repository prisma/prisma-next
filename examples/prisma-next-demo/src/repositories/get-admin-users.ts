import type { Runtime } from '@prisma-next/sql-runtime';
import { createRepositoryClient } from './client';

export async function repositoryGetAdminUsers(limit: number, runtime: Runtime) {
  const db = createRepositoryClient(runtime);
  return db.users.admins().take(limit).findMany().toArray();
}
