import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserRow = DefaultModelRow<Contract, 'User'>;

export interface OrmClientUpsertUserInput {
  readonly id: string;
  readonly email: string;
  readonly kind: 'admin' | 'user';
  readonly createdAt?: Date | string;
}

export async function ormClientUpsertUser(data: OrmClientUpsertUserInput, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'email', 'kind', 'createdAt').upsert({
    create: {
      id: toUserId(data.id),
      email: data.email,
      kind: data.kind,
      createdAt: toUserCreatedAt(data.createdAt),
    },
    update: {
      email: data.email,
      kind: data.kind,
    },
  });
}

function toUserId(value: string): UserRow['id'] {
  return value as UserRow['id'];
}

function toUserCreatedAt(value: Date | string | undefined): UserRow['createdAt'] {
  const resolved = value ?? new Date();
  return (resolved instanceof Date ? resolved.toISOString() : resolved) as UserRow['createdAt'];
}
