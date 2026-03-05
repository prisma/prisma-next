import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserRow = DefaultModelRow<Contract, 'User'>;

export interface OrmClientCreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly kind: 'admin' | 'user';
  readonly createdAt: Date | string;
}

export async function ormClientCreateUser(data: OrmClientCreateUserInput, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'email', 'kind').create({
    id: toUserId(data.id),
    email: data.email,
    kind: data.kind,
    createdAt: toUserCreatedAt(data.createdAt),
  });
}

function toUserId(value: string): UserRow['id'] {
  return value as UserRow['id'];
}

function toUserCreatedAt(value: Date | string): UserRow['createdAt'] {
  return (value instanceof Date ? value.toISOString() : value) as UserRow['createdAt'];
}
