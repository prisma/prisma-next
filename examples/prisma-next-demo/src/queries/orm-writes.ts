import { param } from '@prisma-next/sql-query/param';
import { orm } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';

export async function ormCreateUser(email: string) {
  const runtime = getRuntime();

  const plan = orm.user().create({ email });

  const result = runtime.execute(plan);
  let affectedRows = 0;
  for await (const _row of result) {
    affectedRows++;
  }
  return affectedRows;
}

export async function ormUpdateUser(userId: number, newEmail: string) {
  const runtime = getRuntime();

  const plan = orm
    .user()
    .update((u) => u.id.eq(param('userId')), { email: newEmail }, { params: { userId } });

  const result = runtime.execute(plan);
  let affectedRows = 0;
  for await (const _row of result) {
    affectedRows++;
  }
  return affectedRows;
}

export async function ormDeleteUser(userId: number) {
  const runtime = getRuntime();

  const plan = orm.user().delete((u) => u.id.eq(param('userId')), { params: { userId } });

  const result = runtime.execute(plan);
  let affectedRows = 0;
  for await (const _row of result) {
    affectedRows++;
  }
  return affectedRows;
}
