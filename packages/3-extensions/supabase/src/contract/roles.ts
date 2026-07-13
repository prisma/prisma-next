import { enumType, member } from '@prisma-next/sql-contract-ts/contract-builder';

/**
 * Supabase's three standard Postgres roles as a Prisma Next enum — the
 * single source of truth for the role vocabulary. Runtime-only: the shipped
 * contract declares the roles via top-level PSL `role` blocks, not through
 * this handle. The runtime (`supabase-runtime.ts`, `supabase.ts`) derives
 * its role type from `SupabaseRole.values` and reads member values through
 * `SupabaseRole.members` instead of raw string literals.
 */
export const SupabaseRole = enumType(
  'SupabaseRole',
  { codecId: 'pg/text@1', nativeType: 'text' },
  member('Anon', 'anon'),
  member('Authenticated', 'authenticated'),
  member('ServiceRole', 'service_role'),
);

export type SupabaseRole = (typeof SupabaseRole)['values'][number];

/** The JWT claim key Supabase stores the Postgres role under. */
export const SUPABASE_JWT_ROLE_CLAIM = 'role';

export function isSupabaseRole(value: string): value is SupabaseRole {
  return SupabaseRole.values.some((role) => role === value);
}
