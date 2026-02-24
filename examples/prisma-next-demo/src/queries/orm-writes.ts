import { generateId } from '@prisma-next/ids/runtime';
import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from '../orm-client/client';
import type { Contract } from '../prisma/contract.d';

type UserRow = DefaultModelRow<Contract, 'User'>;

export async function ormCreateUser(
  data: { email: string; createdAt: Date; kind: 'admin' | 'user' },
  runtime: Runtime,
) {
  const id = generateId({ id: 'uuidv4' });
  const db = createOrmClient(runtime);
  const created = await db.users.create({
    id: toUserId(id),
    email: data.email,
    createdAt: toUserCreatedAt(data.createdAt),
    kind: data.kind,
  });
  return created ? 1 : 0;
}

export async function ormUpdateUser(userId: string, newEmail: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  const updated = await db.users.where({ id: toUserId(userId) }).update({ email: newEmail });
  return updated ? 1 : 0;
}

export async function ormDeleteUser(userId: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  const deleted = await db.users.where({ id: toUserId(userId) }).delete();
  return deleted ? 1 : 0;
}

function toUserId(value: string): UserRow['id'] {
  return value as UserRow['id'];
}

function toUserCreatedAt(value: Date | string): UserRow['createdAt'] {
  return (value instanceof Date ? value.toISOString() : value) as UserRow['createdAt'];
}
