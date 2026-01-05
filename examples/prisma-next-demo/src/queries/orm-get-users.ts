import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/query';
import { collect } from './utils';

export async function ormGetUsers(limit: number, runtime: Runtime) {
  const plan = orm
    .user()
    .select((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    }))
    .orderBy((u) => u.createdAt.desc())
    .take(limit)
    .findMany();

  return collect(runtime.execute(plan));
}
