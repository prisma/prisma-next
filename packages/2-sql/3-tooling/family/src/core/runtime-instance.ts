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
 * Identity-only interface for runtime plane. No runtime creation API.
 *
 * Runtime creation should use the stack/context/runtime factory pattern directly:
 * - createExecutionStack({ target, adapter, driver, extensionPacks })
 * - instantiateExecutionStack(stack)
 * - createExecutionContext({ contract, stack: stackInstance })
 * - createRuntime({ stack: stackInstance, contract, context, driverOptions, verify, ... })
 */
export interface SqlRuntimeFamilyInstance extends RuntimeFamilyInstance<'sql'> {}

/**
 * Creates a SQL runtime family instance (identity-only).
 *
 * This instance is identity-only and does not provide runtime creation.
 * Use stack/context/runtime factories directly for runtime creation.
 */
export function createSqlRuntimeFamilyInstance(): SqlRuntimeFamilyInstance {
  return {
    familyId: 'sql' as const,
  };
}
