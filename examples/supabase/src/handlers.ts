import type { RoleBoundDb } from '@prisma-next/extension-supabase/runtime';
import type { Contract } from './contract';

export async function insertAndReadProfile(
  db: RoleBoundDb<Contract>,
  username: string,
  userId = '00000000-0000-0000-0000-000000000000',
) {
  return db.execute(
    db.sql.public.profile
      .insert([{ username, userId }])
      .returning('id', 'username', 'userId')
      .build(),
  );
}
