import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { PostgresDriverOptions } from '@prisma-next/driver-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import sqlFamily from '@prisma-next/family-sql/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { Extension, Log, Plugin, Runtime } from '@prisma-next/sql-runtime';
import { setupTestDatabase } from '@prisma-next/sql-runtime/test/utils';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Client } from 'pg';

export interface CreateTestRuntimeOptions {
  readonly verify?: {
    mode: 'onFirstUse' | 'startup' | 'always';
    requireMarker?: boolean;
  };
  readonly extensions?: readonly Extension[];
  readonly plugins?: readonly Plugin[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

/**
 * Creates a runtime with standard test configuration using runtime descriptors.
 * This helper DRYs up the common pattern of runtime creation in tests.
 */
export function createTestRuntime(
  contract: SqlContract<SqlStorage>,
  driverOptions: PostgresDriverOptions,
  options?: CreateTestRuntimeOptions,
): Runtime {
  const verify: {
    mode: 'onFirstUse' | 'startup' | 'always';
    requireMarker: boolean;
  } = options?.verify
    ? {
        ...options.verify,
        requireMarker: options.verify.requireMarker ?? false,
      }
    : { mode: 'onFirstUse', requireMarker: false };

  // Create runtime family instance from descriptors
  const familyInstance = sqlFamily.create({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });

  // Create runtime using family instance
  return familyInstance.createRuntime({
    contract,
    driverOptions,
    verify,
    ...(options?.extensions ? { extensions: options.extensions } : {}),
    ...(options?.plugins ? { plugins: options.plugins } : {}),
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.log ? { log: options.log } : {}),
  });
}

/**
 * Creates a runtime with the given contract and database client using runtime descriptors.
 * This helper DRYs up the common pattern of runtime creation in e2e tests.
 */
export function createTestRuntimeFromClient(
  contract: SqlContract<SqlStorage>,
  client: Client,
  options?: CreateTestRuntimeOptions,
): Runtime {
  return createTestRuntime(
    contract,
    {
      connect: { client },
      cursor: { disabled: true },
    },
    {
      ...options,
      verify: options?.verify ?? ({ mode: 'onFirstUse', requireMarker: true } as const),
    },
  );
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in e2e tests.
 */
export async function setupE2EDatabase(
  client: Client,
  contract: SqlContract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await setupTestDatabase(client, contract, setupFn);
}

// Re-export setupTestDatabase for convenience
export { setupTestDatabase } from '@prisma-next/sql-runtime/test/utils';
