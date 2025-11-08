import type { Plan, ResultType } from '@prisma-next/contract/types';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import type {
  Adapter,
  LoweredStatement,
  SelectAst,
  SqlContract,
  SqlDriver,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { collectAsync, drainAsyncIterable } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import type { Log, Plugin, SqlStatement } from '../src/exports';
import {
  createRuntime,
  createRuntimeContext,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '../src/exports';

/**
 * Executes a plan and collects all results into an array.
 * This helper DRYs up the common pattern of executing plans in tests.
 * The return type is inferred from the plan's type parameter.
 */
export async function executePlanAndCollect<P extends Plan>(
  runtime: ReturnType<typeof createRuntime>,
  plan: P,
): Promise<ResultType<P>[]> {
  type Row = ResultType<P>;
  return collectAsync<Row>(runtime.execute<Row>(plan));
}

/**
 * Drains a plan execution, consuming all results without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainPlanExecution(
  runtime: ReturnType<typeof createRuntime>,
  plan: Plan,
): Promise<void> {
  return drainAsyncIterable(runtime.execute(plan));
}

/**
 * Executes a SQL statement on a database client.
 */
export async function executeStatement(client: Client, statement: SqlStatement): Promise<void> {
  if (statement.params.length > 0) {
    await client.query(statement.sql, [...statement.params]);
    return;
  }

  await client.query(statement.sql);
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in tests.
 */
export async function setupTestDatabase(
  client: Client,
  contract: SqlContract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await client.query('drop schema if exists prisma_contract cascade');
  await client.query('create schema if not exists public');

  await setupFn(client);

  await executeStatement(client, ensureSchemaStatement);
  await executeStatement(client, ensureTableStatement);
  const write = writeContractMarker({
    coreHash: contract.coreHash,
    profileHash: contract.profileHash ?? contract.coreHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

/**
 * Writes a contract marker to the database.
 * This helper DRYs up the common pattern of writing contract markers in tests.
 */
export async function writeTestContractMarker(
  client: Client,
  contract: SqlContract<SqlStorage>,
): Promise<void> {
  const write = writeContractMarker({
    coreHash: contract.coreHash,
    profileHash: contract.profileHash ?? contract.coreHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

export interface CreateTestRuntimeOptions {
  readonly verify?: {
    mode: 'onFirstUse' | 'startup' | 'always';
    requireMarker?: boolean;
  };
  readonly plugins?: readonly Plugin[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

/**
 * Creates a runtime context with standard test configuration.
 * This helper DRYs up the common pattern of context creation in tests.
 */
export function createTestContext(
  contract: SqlContract<SqlStorage>,
  adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
  options?: {
    extensions?: ReadonlyArray<import('../src/context').Extension>;
  },
): ReturnType<typeof createRuntimeContext> {
  return createRuntimeContext({
    contract,
    adapter,
    extensions: options?.extensions ?? [],
  });
}

/**
 * Creates a runtime with standard test configuration.
 * This helper DRYs up the common pattern of runtime creation in tests.
 */
export function createTestRuntime(
  contract: SqlContract<SqlStorage>,
  adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
  driver: SqlDriver,
  options?: CreateTestRuntimeOptions,
): ReturnType<typeof createRuntime> {
  const verify: {
    mode: 'onFirstUse' | 'startup' | 'always';
    requireMarker: boolean;
  } = options?.verify
    ? {
        ...options.verify,
        requireMarker: options.verify.requireMarker ?? false,
      }
    : { mode: 'onFirstUse', requireMarker: false };
  const context = createTestContext(contract, adapter);
  const runtimeOptions: {
    adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
    driver: SqlDriver;
    verify: {
      mode: 'onFirstUse' | 'startup' | 'always';
      requireMarker: boolean;
    };
    context: ReturnType<typeof createRuntimeContext>;
    plugins?: readonly Plugin[];
    mode?: 'strict' | 'permissive';
    log?: Log;
  } = {
    adapter,
    driver,
    verify,
    context,
  };
  if (options?.plugins) {
    runtimeOptions.plugins = options.plugins;
  }
  if (options?.mode) {
    runtimeOptions.mode = options.mode;
  }
  if (options?.log) {
    runtimeOptions.log = options.log;
  }
  return createRuntime(runtimeOptions);
}

/**
 * Creates a runtime with the given contract and database client.
 * This helper DRYs up the common pattern of runtime creation in e2e tests.
 */
export function createTestRuntimeFromClient(
  contract: SqlContract<SqlStorage>,
  client: Client,
  adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
  options?: CreateTestRuntimeOptions,
): ReturnType<typeof createRuntime> {
  const driver = createPostgresDriverFromOptions({
    connect: { client },
    cursor: { disabled: true },
  });
  return createTestRuntime(contract, adapter, driver, {
    ...options,
    verify: options?.verify ?? ({ mode: 'onFirstUse', requireMarker: true } as const),
  });
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

/**
 * Creates a stub adapter for testing.
 * This helper DRYs up the common pattern of adapter creation in tests.
 */
export function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

/**
 * Creates a valid test contract without using validateContract.
 * Ensures mappings are present and returns the contract with proper typing.
 * This helper allows tests to create contracts without depending on sql-query.
 */
export function createTestContract<T extends SqlContract<SqlStorage>>(contract: T): T {
  // Ensure mappings are present
  if (!contract.mappings) {
    return {
      ...contract,
      mappings: { codecTypes: {}, operationTypes: {} },
    } as T;
  }
  return contract;
}

// Re-export generic utilities from test-utils
export {
  collectAsync,
  createDevDatabase,
  type DevDatabase,
  teardownTestDatabase,
  withClient,
} from '@prisma-next/test-utils';
