import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from './prisma/db';

export async function insertAndReadProfile(runtime: Runtime, username: string) {
  const profile = db.sql['profile'];
  if (!profile) {
    throw new Error('profile table not found in contract');
  }
  await runtime.execute(profile.insert([{ username }]).build());
  return runtime.execute(profile.select('id', 'username').build());
}
