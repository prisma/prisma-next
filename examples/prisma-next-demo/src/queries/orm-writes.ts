import { param } from '@prisma-next/sql-relational-core/param';
import { orm } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';

export async function ormCreateUser(email: string) {
  const runtime = getRuntime();

  const plan = orm.user().create({ email });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}

export async function ormUpdateUser(userId: number, newEmail: string) {
  const runtime = getRuntime();

  const plan = orm
    .user()
    .update((u) => u.id.eq(param('userId')), { email: newEmail }, { params: { userId } });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}

export async function ormDeleteUser(userId: number) {
  const runtime = getRuntime();

  const plan = orm.user().delete((u) => u.id.eq(param('userId')), { params: { userId } });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}
