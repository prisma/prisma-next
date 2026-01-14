import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { DEFAULT_ROLE, type Role } from '../enums/role';
import { orm } from '../prisma/query';

export async function ormCreateUser(
  data: { id: number; email: string; role?: Role; createdAt: Date },
  runtime: Runtime,
) {
  const plan = orm.user().create({
    id: data.id,
    email: data.email,
    role: data.role ?? DEFAULT_ROLE,
    createdAt: data.createdAt,
  });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}

export async function ormUpdateUser(userId: number, newEmail: string, runtime: Runtime) {
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

export async function ormDeleteUser(userId: number, runtime: Runtime) {
  const plan = orm.user().delete((u) => u.id.eq(param('userId')), { params: { userId } });

  // Drain the result stream (DML operations don't return rows without RETURNING)
  for await (const _row of runtime.execute(plan)) {
    // DML operations without RETURNING don't yield rows
  }

  // For now, return 1 if no error was thrown (actual row count would require RETURNING or telemetry)
  // This is a limitation - we'd need to add RETURNING to get actual affected row count
  return 1;
}
