import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import type {
  PostgresBinding,
  PostgresDriverCreateOptions,
} from '@prisma-next/driver-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Log,
  Runtime,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  VerifyMarkerOption,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import { setupTestDatabase as setupTestDatabaseBase } from '@prisma-next/sql-runtime/test/utils';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Client } from 'pg';
import { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';

export interface CreateTestRuntimeOptions {
  readonly verifyMarker?: VerifyMarkerOption;
  readonly extensionPacks?: readonly SqlRuntimeExtensionDescriptor<'postgres'>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

interface IntegrationDriverOptions {
  readonly binding: PostgresBinding;
  readonly cursor?: PostgresDriverCreateOptions['cursor'];
}

/**
 * Creates a runtime with standard test configuration using runtime descriptors.
 * This helper DRYs up the common pattern of runtime creation in tests.
 */
export async function createTestRuntime(
  contract: Contract<SqlStorage>,
  driverOptions: IntegrationDriverOptions,
  options?: CreateTestRuntimeOptions,
): Promise<Runtime> {
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver:
      driverOptions.cursor === undefined
        ? postgresDriver
        : {
            ...postgresDriver,
            create() {
              return postgresDriver.create({ cursor: driverOptions.cursor });
            },
          },
    extensionPacks: options?.extensionPacks ?? [],
  });

  const stackInstance = instantiateExecutionStack(stack);

  const context = createExecutionContext({
    contract,
    stack,
  });

  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver missing from execution stack instance');
  }
  const binding = driverOptions.binding;
  try {
    await driver.connect(binding);
  } catch (error) {
    if (binding.kind === 'pgPool') {
      await binding.pool.end();
    }
    throw error;
  }

  return createRuntime({
    stackInstance,
    context,
    driver,
    ...(options?.verifyMarker !== undefined ? { verifyMarker: options.verifyMarker } : {}),
    ...(options?.middleware ? { middleware: options.middleware } : {}),
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.log ? { log: options.log } : {}),
  });
}

/**
 * Creates a runtime with the given contract and database client using runtime descriptors.
 * This helper DRYs up the common pattern of runtime creation in e2e tests.
 */
export async function createTestRuntimeFromClient(
  contract: Contract<SqlStorage>,
  client: Client,
  options?: CreateTestRuntimeOptions,
): Promise<Runtime> {
  return createTestRuntime(
    contract,
    {
      binding: { kind: 'pgClient', client },
      cursor: { disabled: true },
    },
    options,
  );
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in e2e tests.
 */
export async function setupE2EDatabase(
  client: Client,
  contract: Contract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await setupTestDatabase(client, contract, setupFn);
}

export async function setupTestDatabase(
  client: Client,
  contract: Contract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await setupTestDatabaseBase(client, contract, setupFn, bootstrapPostgresSignMarkerTables);
}

export { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';
