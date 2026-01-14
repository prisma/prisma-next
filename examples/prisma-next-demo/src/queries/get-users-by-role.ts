/**
 * Example query demonstrating enum filtering.
 *
 * This query selects users filtered by their role enum field.
 * TypeScript enforces that the role parameter is one of the valid enum values.
 */
import { param } from '@prisma-next/sql-relational-core/param';
import type { Role } from '../enums/role';
import { sql, tables } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

/**
 * Gets users with a specific role.
 *
 * @param role - The role to filter by
 * @param limit - Maximum number of users to return
 * @returns Array of users matching the role
 *
 * @example
 * ```ts
 * // Get all admin users
 * const admins = await getUsersByRole('ADMIN');
 *
 * // Get up to 5 moderators
 * const mods = await getUsersByRole('MODERATOR', 5);
 * ```
 */
export async function getUsersByRole(role: Role, limit = 10) {
  const runtime = getRuntime();
  const userTable = tables.user;
  const userColumns = userTable.columns;

  const plan = sql
    .from(userTable)
    .where(userColumns.role.eq(param('role')))
    .select({
      id: userColumns.id,
      email: userColumns.email,
      role: userColumns.role,
      createdAt: userColumns.createdAt,
    })
    .limit(limit)
    .build({ params: { role } });

  return collect(runtime.execute(plan));
}
