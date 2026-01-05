import { param } from '@prisma-next/sql-relational-core/param';
import type { Role } from '../prisma/contract.d';
import { sql, tables } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

/**
 * Get all users with a specific role.
 * Demonstrates filtering by an enum column.
 */
export async function getUsersByRole(role: Role) {
  const runtime = getRuntime();
  const userTable = tables.user;

  const plan = sql
    .from(userTable)
    .where(userTable.columns.role.eq(param('role')))
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      role: userTable.columns.role,
      createdAt: userTable.columns.createdAt,
    })
    .build({ params: { role } });

  return collect(runtime.execute(plan));
}

/**
 * Get all admin users.
 * Demonstrates using enum literal values in queries.
 */
export async function getAdminUsers() {
  const runtime = getRuntime();
  const userTable = tables.user;

  const plan = sql
    .from(userTable)
    .where(userTable.columns.role.eq('ADMIN'))
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      role: userTable.columns.role,
    })
    .build();

  return collect(runtime.execute(plan));
}

/**
 * Get all users grouped by role.
 * Returns users with their role for client-side grouping.
 */
export async function getUsersWithRoles(limit = 100) {
  const runtime = getRuntime();
  const userTable = tables.user;

  const plan = sql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      role: userTable.columns.role,
    })
    .limit(limit)
    .build();

  const users = await collect(runtime.execute(plan));

  // Group users by role client-side
  const byRole = {
    USER: users.filter((u) => u.role === 'USER'),
    ADMIN: users.filter((u) => u.role === 'ADMIN'),
    MODERATOR: users.filter((u) => u.role === 'MODERATOR'),
  };

  return byRole;
}
