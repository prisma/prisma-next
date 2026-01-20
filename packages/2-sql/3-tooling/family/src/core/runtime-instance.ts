import type {
  RuntimeDriverInstance,
  RuntimeFamilyInstance,
} from '@prisma-next/core-execution-plane/types';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';

/**
 * SQL runtime driver instance type.
 * Combines identity properties with SQL-specific behavior methods.
 */
export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver;

// Re-export SqlRuntimeAdapterInstance from sql-runtime for consumers
export type { SqlRuntimeAdapterInstance } from '@prisma-next/sql-runtime';

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
