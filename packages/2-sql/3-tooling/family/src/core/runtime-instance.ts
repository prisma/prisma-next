import type { RuntimeFamilyInstance } from '@prisma-next/core-execution-plane/types';

// Re-export SQL runtime instance types from canonical source
export type { SqlRuntimeAdapterInstance, SqlRuntimeDriverInstance } from '@prisma-next/sql-runtime';

/**
 * SQL runtime family instance interface.
 */
export interface SqlRuntimeFamilyInstance extends RuntimeFamilyInstance<'sql'> {}

/**
 * Creates a SQL runtime family instance.
 */
export function createSqlRuntimeFamilyInstance(): SqlRuntimeFamilyInstance {
  return {
    familyId: 'sql' as const,
  };
}
