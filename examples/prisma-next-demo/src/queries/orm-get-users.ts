import { orm } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

export async function ormGetUsers(limit = 10) {
  const runtime = getRuntime();

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
