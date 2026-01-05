import { param } from '@prisma-next/sql-relational-core/param';
import type { Role } from '../prisma/contract.d';
import { enums, sql, tables } from '../prisma/query';
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
    .where(userTable.columns.role.eq(param('role')))
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      role: userTable.columns.role,
    })
    .build({ params: { role: 'ADMIN' } });

  return collect(runtime.execute(plan));
}

/**
 * Get all users grouped by role.
 * Demonstrates using enums.Role.values to dynamically group by all enum values.
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

  // Dynamically group users by all role values from the contract
  // This ensures grouping stays in sync with contract changes
  const byRole = Object.fromEntries(
    enums.Role.values.map((role) => [role, users.filter((u) => u.role === role)]),
  );

  return byRole;
}

/**
 * Get all valid role values from the contract.
 * Demonstrates accessing enum definitions at runtime via schema().enums.
 */
export function getRoleValues(): readonly ['USER', 'ADMIN', 'MODERATOR'] {
  // Access enum values directly from the schema
  // This is useful for building dropdowns, validation, etc.
  return enums.Role.values;
}
