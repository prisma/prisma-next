import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/query.ts';
import { collect } from './utils.ts';

export async function ormGetUsers(limit: number, runtime: Runtime) {
  const plan = orm
    .user()
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .orderBy((u) => u.createdAt.desc())
    .take(limit)
    .findMany();

  return collect(runtime.execute(plan));
}
