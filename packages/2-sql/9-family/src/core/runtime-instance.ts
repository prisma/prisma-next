import type { RuntimeFamilyInstance } from '@prisma-next/core-execution-plane/types';

/**
 * SQL execution-plane family instance interface.
 *
 * Note: this is currently named `SqlRuntimeFamilyInstance` because the execution plane
 * framework types are still using the `Runtime*` naming (`RuntimeFamilyInstance`, etc.).
 *
 * This will be renamed to `SqlExecutionFamilyInstance` as part of `TML-1842`.
 */
export interface SqlRuntimeFamilyInstance extends RuntimeFamilyInstance<'sql'> {}

/**
 * Creates a SQL execution-plane family instance.
 *
 * This will be renamed to `createSqlExecutionFamilyInstance()` as part of `TML-1842`.
 */
export function createSqlRuntimeFamilyInstance(): SqlRuntimeFamilyInstance {
  return {
    familyId: 'sql' as const,
  };
}
