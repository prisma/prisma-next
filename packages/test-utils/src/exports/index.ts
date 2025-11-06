import { unstable_startServer } from '@prisma/dev';
import type { StartServerOptions } from '@prisma/dev';
import { Client } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

function normalizeConnectionString(raw: string): string {
  // eslint-disable-next-line no-undef
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
export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

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
export interface Runtime {
  execute<Row = Record<string, unknown>>(plan: Plan<Row>): AsyncIterable<Row>;
}

export interface Plan<_Row = unknown> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly meta: {
    readonly target: string;
    readonly targetFamily?: string;
    readonly coreHash: string;
    readonly profileHash?: string;
    readonly lane: string;
    readonly paramDescriptors?:
      | ReadonlyArray<unknown>
      | ReadonlyArray<{
          readonly name: string;
          readonly [key: string]: unknown;
        }>;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export type ResultType<P> = P extends Plan<infer R> ? R : never;

export async function executePlanAndCollect<P>(
  runtime: { execute<Row = Record<string, unknown>>(plan: unknown): AsyncIterable<Row> },
  plan: P,
): Promise<ResultType<P>[]> {
  type Row = ResultType<P>;
  return collectAsync<Row>(runtime.execute<Row>(plan as unknown as P));
}

/**
 * Drains a plan execution, consuming all results without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainPlanExecution<P>(
  runtime: { execute<Row = Record<string, unknown>>(plan: unknown): AsyncIterable<Row> },
  plan: P,
): Promise<void> {
  return drainAsyncIterable(runtime.execute(plan as unknown as P));
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in tests.
 */
export interface ContractMarkerStatements {
  readonly ensureSchema: SqlStatement;
  readonly ensureTable: SqlStatement;
  readonly writeMarker: (options: {
    coreHash: string;
    profileHash: string;
    contractJson: unknown;
    canonicalVersion: number;
  }) => { insert: SqlStatement };
}

export async function setupTestDatabase(
  client: Client,
  contract: { coreHash: string; profileHash?: string },
  setupFn: (client: Client) => Promise<void>,
  markerStatements: ContractMarkerStatements,
): Promise<void> {
  await client.query('drop schema if exists prisma_contract cascade');
  await client.query('create schema if not exists public');

  await setupFn(client);

  await executeStatement(client, markerStatements.ensureSchema);
  await executeStatement(client, markerStatements.ensureTable);
  const write = markerStatements.writeMarker({
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
  contract: { coreHash: string; profileHash?: string },
  markerStatements: ContractMarkerStatements,
): Promise<void> {
  const write = markerStatements.writeMarker({
    coreHash: contract.coreHash,
    profileHash: contract.profileHash ?? contract.coreHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
  await executeStatement(client, write.insert);
}

/**
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export async function loadContractFromDisk<TContract = unknown>(
  contractJsonPath: string,
  validateContract: (json: Record<string, unknown>) => TContract,
): Promise<TContract> {
  const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  return validateContract(contractJson);
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
  validateContract: (json: Record<string, unknown>) => unknown,
): Promise<unknown> {
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

  return validateContract(emittedContract);
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in e2e tests.
 */
export async function setupE2EDatabase(
  client: Client,
  contract: { coreHash: string; profileHash?: string },
  setupFn: (client: Client) => Promise<void>,
  markerStatements: ContractMarkerStatements,
): Promise<void> {
  await setupTestDatabase(client, contract, setupFn, markerStatements);
}
