import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from './prisma/db';

export async function insertAndReadProfile(runtime: Runtime, username: string) {
  return runtime.execute(db.sql.profile.insert([{ username }]).returning('id', 'username').build());
}
