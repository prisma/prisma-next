/**
 * Shared helpers for family.schema-verify tests.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { ControlExtensionDescriptor } from '@prisma-next/core-control-plane/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql, { type SqlControlFamilyInstance } from '@prisma-next/family-sql/control';
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
 * Creates a SQL control-plane family instance for testing.
 */
export function createFamilyInstance(
  extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [],
): SqlControlFamilyInstance {
  return sql.create({
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions,
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
  options: {
    strict?: boolean;
    extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
  } = {},
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

/**
 * Verification node structure (matches SchemaVerificationNode from control-plane).
 */
export interface VerificationNode {
  readonly status: 'pass' | 'warn' | 'fail';
  readonly code: string;
  readonly children: readonly VerificationNode[];
}

/**
 * Recursively searches a verification tree for a node matching a predicate.
 *
 * @param node - Root node to search from
 * @param predicate - Function to test each node
 * @returns true if any node in the tree matches the predicate
 */
export function findNodeByPredicate(
  node: VerificationNode,
  predicate: (node: VerificationNode) => boolean,
): boolean {
  if (predicate(node)) {
    return true;
  }
  return node.children.some((child) => findNodeByPredicate(child, predicate));
}

/**
 * Recursively searches a verification tree for a node with specific status and code.
 *
 * @param node - Root node to search from
 * @param status - Status to match ('pass' | 'warn' | 'fail')
 * @param code - Code to match
 * @returns true if a matching node is found
 */
export function findNodeByStatusAndCode(
  node: VerificationNode,
  status: 'pass' | 'warn' | 'fail',
  code: string,
): boolean {
  return findNodeByPredicate(node, (n) => n.status === status && n.code === code);
}
