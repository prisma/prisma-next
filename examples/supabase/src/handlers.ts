import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from './prisma/db';

export async function insertAndReadProfile(runtime: Runtime, username: string, userId: string) {
  return runtime.execute(
    db.sql.profile.insert([{ username, userId }]).returning('id', 'username', 'userId').build(),
  );
}
