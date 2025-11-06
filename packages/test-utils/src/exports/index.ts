import { unstable_startServer } from '@prisma/dev';
import type { StartServerOptions } from '@prisma/dev';
import { Client } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRuntime, ensureSchemaStatement, ensureTableStatement, writeContractMarker } from '@prisma-next/runtime';
import type { Plugin, Log } from '@prisma-next/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { SqlDriver } from '@prisma-next/sql-target';
import type { Plan, Adapter, SelectAst, LoweredStatement, ResultType } from '@prisma-next/sql-query/types';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlStatement } from '@prisma-next/runtime';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';

const execFileAsync = promisify(execFile);

function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

export interface DevDatabase {
  readonly connectionString: string;
  close(): Promise<void>;
}

/**
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 */
export async function createDevDatabase(options?: StartServerOptions): Promise<DevDatabase> {
  const server = await unstable_startServer(options);
  return {
    connectionString: normalizeConnectionString(server.database.connectionString),
    async close() {
      await server.close();
    },
  };
}

/**
 * Executes a function with a dev database, automatically cleaning up afterward.
 */
export async function withDevDatabase<T>(
  fn: (ctx: DevDatabase) => Promise<T>,
  options?: StartServerOptions,
): Promise<T> {
  const database = await createDevDatabase(options);
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

/**
 * Executes a function with a database client, automatically cleaning up afterward.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
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
 * Drains an async iterable, consuming all values without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

/**
 * Collects all values from an async iterable into an array.
 * Useful for testing query results.
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

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
 * Tears down test database by dropping schema and tables.
 * This helper DRYs up the common pattern of database teardown in tests.
 */
export async function teardownTestDatabase(client: Client, tables?: string[]): Promise<void> {
  if (tables && tables.length > 0) {
    for (const table of tables) {
      await client.query(`drop table if exists ${table}`);
    }
  }
  await client.query('drop schema if exists prisma_contract cascade');
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
  readonly verify?: { mode: 'onFirstUse' | 'startup' | 'always'; requireMarker?: boolean };
  readonly plugins?: readonly Plugin[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
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
  const verify: { mode: 'onFirstUse' | 'startup' | 'always'; requireMarker: boolean } =
    options?.verify
      ? { ...options.verify, requireMarker: options.verify.requireMarker ?? false }
      : { mode: 'onFirstUse', requireMarker: false };
  const runtimeOptions: {
    contract: SqlContract<SqlStorage>;
    adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
    driver: SqlDriver;
    verify: { mode: 'onFirstUse' | 'startup' | 'always'; requireMarker: boolean };
    plugins?: readonly Plugin[];
    mode?: 'strict' | 'permissive';
    log?: Log;
  } = {
    contract,
    adapter,
    driver,
    verify,
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
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export async function loadContractFromDisk<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>(
  contractJsonPath: string,
): Promise<TContract> {
  const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  return validateContract<TContract>(contractJson);
}

/**
 * Emits a contract via CLI and verifies it matches the on-disk contract.json.
 * This should be used in a single test to verify contract emission correctness.
 * Returns the emitted contract for further use in the test.
 */
export async function emitAndVerifyContract(
  cliPath: string,
  contractTsPath: string,
  adapterPath: string,
  outputDir: string,
  expectedContractJsonPath: string,
): Promise<SqlContract<SqlStorage>> {
  await execFileAsync('node', [
    cliPath,
    'emit',
    '--contract',
    contractTsPath,
    '--out',
    outputDir,
    '--adapter',
    adapterPath,
  ]);

  const emittedContractJsonPath = join(outputDir, 'contract.json');
  const emittedContractContent = await readFile(emittedContractJsonPath, 'utf-8');
  const emittedContract = JSON.parse(emittedContractContent) as Record<string, unknown>;

  const expectedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const expectedContract = JSON.parse(expectedContractContent) as Record<string, unknown>;

  if (JSON.stringify(emittedContract) !== JSON.stringify(expectedContract)) {
    throw new Error(
      `Emitted contract does not match expected contract on disk.\n` +
        `Expected: ${expectedContractJsonPath}\n` +
        `Emitted: ${emittedContractJsonPath}`,
    );
  }

  return validateContract<SqlContract<SqlStorage>>(emittedContract);
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
    verify: options?.verify ?? { mode: 'onFirstUse', requireMarker: true } as const,
  });
}

