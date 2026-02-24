import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserId = DefaultModelRow<Contract, 'User'>['id'];

export async function ormClientFindUserById(id: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.users.find({ id: toUserId(id) });
}

function toUserId(value: string): UserId {
  return value as UserId;
}
