import type { Runtime } from '@prisma-next/sql-runtime';
import type { Role } from '../prisma/contract.d';
import { enums, orm } from '../prisma/query';
import { collect } from './utils';

/**
 * Get all users with a specific role using the ORM API.
 * Demonstrates filtering by an enum column with type-safe role parameter.
 */
export async function ormGetUsersByRole(role: Role, runtime: Runtime) {
  const plan = orm
    .user()
    .where((u) => u.role.eq(role))
    .select((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    }))
    .findMany();

  return collect(runtime.execute(plan));
}

/**
 * Get all moderators using the ORM API.
 * Demonstrates using enum literal values with the ORM.
 */
export async function ormGetModerators(runtime: Runtime) {
  const plan = orm
    .user()
    .where((u) => u.role.eq('MODERATOR'))
    .select((u) => ({
      id: u.id,
      email: u.email,
    }))
    .findMany();

  return collect(runtime.execute(plan));
}

/**
 * Get users excluding a specific role.
 * Demonstrates using not-equal with enums.
 */
export async function ormGetNonAdminUsers(runtime: Runtime) {
  const plan = orm
    .user()
    .where((u) => u.role.neq('ADMIN'))
    .select((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
    }))
    .orderBy((u) => u.email.asc())
    .findMany();

  return collect(runtime.execute(plan));
}

/**
 * Get user counts for each role.
 * Demonstrates iterating over enum values from the contract.
 */
export async function ormGetUserCountsByRole(runtime: Runtime) {
  const counts: Record<Role, number> = {} as Record<Role, number>;

  // Iterate over all role values from the contract
  for (const role of enums.Role.values) {
    const plan = orm
      .user()
      .where((u) => u.role.eq(role))
      .select((u) => ({ id: u.id }))
      .findMany();

    const users = await collect(runtime.execute(plan));
    counts[role] = users.length;
  }

  return counts;
}

/**
 * Validate if a string is a valid role.
 * Uses enum values from the contract for runtime validation.
 */
export function isValidRole(value: string): value is Role {
  return (enums.Role.values as readonly string[]).includes(value);
}
