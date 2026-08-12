import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUsers(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.take(limit).all();
}
