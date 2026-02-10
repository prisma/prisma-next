import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/query';

export async function ormCreateUser(
  data: { email: string; createdAt: Date; kind: 'admin' | 'user' },
  runtime: Runtime,
) {
  const plan = orm.user().create({ email: data.email, createdAt: data.createdAt, kind: data.kind });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}

export async function ormUpdateUser(userId: string, newEmail: string, runtime: Runtime) {
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

export async function ormDeleteUser(userId: string, runtime: Runtime) {
  const plan = orm.user().delete((u) => u.id.eq(param('userId')), { params: { userId } });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}
