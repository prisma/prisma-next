/**
 * Shared helpers for family.schema-verify tests.
 */
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import postgres from '@prisma-next/target-postgres/control';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { beforeAll } from 'vitest';

export type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
// Re-export common imports for test files
export { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
export { postgresAdapter, postgresDriver, sql, postgres };
export { validateContract };
export type { SqlContract, SqlStorage };
export { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
export { timeouts, withClient };
export { pgvector } from './family.schema-verify.extensions';

/**
 * Sets up a shared dev database for schema verification tests.
 * Call this in a beforeAll hook at the top of your describe block.
 *
 * @returns Object with connectionString getter
 */
export function useDevDatabase(): { getConnectionString: () => string } {
  let connectionString: string | undefined;

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    return async () => {
      await database.close();
    };
  }, timeouts.spinUpPpgDev);

  return {
    getConnectionString: () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      return connectionString;
    },
  };
}

/**
 * Creates a family instance for testing.
 */
export function createFamilyInstance(extensions: readonly unknown[] = []) {
  return sql.create({
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: extensions as never[],
  });
}

/**
 * Creates a driver and runs a test callback, ensuring cleanup.
 */
export async function withDriver<T>(
  connectionString: string,
  callback: (driver: Awaited<ReturnType<typeof postgresDriver.create>>) => Promise<T>,
): Promise<T> {
  const driver = await postgresDriver.create(connectionString);
  try {
    return await callback(driver);
  } finally {
    await driver.close();
  }
}

/**
 * Runs schemaVerify and returns the result.
 */
export async function runSchemaVerify(
  connectionString: string,
  contract: unknown,
  options: { strict?: boolean; extensions?: readonly unknown[] } = {},
) {
  return withDriver(connectionString, async (driver) => {
    const familyInstance = createFamilyInstance(options.extensions);
    const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);
    return familyInstance.schemaVerify({
      driver,
      contractIR: validatedContract,
      strict: options.strict ?? false,
      context: { contractPath: './contract.json' },
    });
  });
}
