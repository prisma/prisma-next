import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

export async function ormGetUserById(userId: number, runtime?: Runtime) {
  const rt = runtime ?? getRuntime();

  const plan = orm
    .user()
    .where((u) => u.id.eq(param('userId')))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .findFirst({
      params: { userId },
    });

  const rows = await collect(rt.execute(plan));
  return rows[0] ?? null;
}
