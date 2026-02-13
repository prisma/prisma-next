import type { Runtime } from '@prisma-next/sql-runtime';
import { createRepositoryClient } from './client';

export async function repositoryGetUsers(limit: number, runtime: Runtime) {
  const db = createRepositoryClient(runtime);
  return db.users.take(limit).findMany().toArray();
}
