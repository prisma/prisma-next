import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/context';
import { collect } from './utils';

export async function ormGetUsers(limit: number, runtime: Runtime) {
  const plan = orm
    .user()
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      kind: u.kind,
    }))
    .orderBy((u) => u.createdAt.desc())
    .take(limit)
    .findMany();

  return collect(runtime.execute(plan));
}
