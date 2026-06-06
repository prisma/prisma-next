import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from './prisma/db';

export async function insertAndReadProfile(runtime: Runtime, username: string) {
  await runtime.execute(db.sql.profile.insert([{ username }]).build());
  return runtime.execute(db.sql.profile.select('id', 'username').build());
}
