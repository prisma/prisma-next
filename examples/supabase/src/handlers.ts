import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from './prisma/db';

export async function insertAndReadProfile(
  runtime: Runtime,
  username: string,
  ownerId = '00000000-0000-0000-0000-000000000000',
) {
  return runtime.execute(
    db.sql.profile
      .insert([{ username, owner_id: ownerId }])
      .returning('id', 'username', 'owner_id')
      .build(),
  );
}
