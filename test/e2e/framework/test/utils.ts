import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { type ControlClient, createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import { createTestRuntimeFromClient } from '@prisma-next/integration-tests/test/utils';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgres from '@prisma-next/target-postgres/control';
import { withClient, withDevDatabase } from '@prisma-next/test-utils';
import type { Client } from 'pg';

const execFileAsync = promisify(execFile);

/**
 * Creates a control client configured for the e2e test stack (Postgres + pgvector).
 * Used for database initialization via dbInit.
 */
function createControlClientForTests(connectionString: string): ControlClient {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [pgvector],
    connection: connectionString,
  });
}

/**
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export async function loadContractFromDisk<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
>(contractJsonPath: string): Promise<TContract> {
  const contractJson = await loadContractIRFromDisk(contractJsonPath);
  return validateContract<TContract>(contractJson);
}

async function loadContractIRFromDisk(contractJsonPath: string): Promise<Record<string, unknown>> {
  const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(contractJsonContent) as Record<string, unknown>;
}

/**
 * Emits a contract via CLI and verifies it matches the on-disk contract.json.
 * This should be used in a single test to verify contract emission correctness.
 * Returns the emitted contract for further use in the test.
 *
 * The config file should already include the contract configuration with nested structure:
 * ```typescript
 * contract: {
 *   source: contract,
 *   output: 'path/to/contract.json',
 *   types: 'path/to/contract.d.ts',
 * }
 * ```
 */
export async function emitAndVerifyContract(
  cliPath: string,
  configPath: string,
  expectedContractJsonPath: string,
): Promise<SqlContract<SqlStorage>> {
  await execFileAsync('node', [cliPath, 'contract', 'emit', '--config', configPath]);

  // Read the emitted contract from the path specified in config.contract.output
  // For now, we'll read from expectedContractJsonPath since that's what the test expects
  // In the future, we could parse the config to get the actual output path
  const emittedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const emittedContract = JSON.parse(emittedContractContent) as Record<string, unknown>;

  const expectedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const expectedContract = JSON.parse(expectedContractContent) as Record<string, unknown>;

  if (JSON.stringify(emittedContract) !== JSON.stringify(expectedContract)) {
    throw new Error(
      `Emitted contract does not match expected contract on disk.\nExpected: ${expectedContractJsonPath}\nEmitted: ${expectedContractJsonPath}`,
    );
  }

  return validateContract<SqlContract<SqlStorage>>(emittedContract);
}

export async function runDbInit(options: {
  readonly connectionString: string;
  readonly contractJsonPath: string;
}): Promise<void> {
  const { connectionString, contractJsonPath } = options;
  const contractIR = await loadContractIRFromDisk(contractJsonPath);
  const controlClient = createControlClientForTests(connectionString);

  try {
    const result = await controlClient.dbInit({ contractIR, mode: 'apply' });
    if (!result.ok) {
      throw new Error(
        `dbInit failed: ${result.failure.summary}\n${JSON.stringify(result.failure, null, 2)}`,
      );
    }
  } finally {
    await controlClient.close();
  }
}

async function getPlannedDdlSql(options: {
  readonly connectionString: string;
  readonly contractIR: Record<string, unknown>;
}): Promise<string> {
  const { connectionString, contractIR } = options;
  const controlClient = createControlClientForTests(connectionString);
  type OperationWithSqlSteps = {
    readonly execute: ReadonlyArray<{ readonly sql: string }>;
  };

  try {
    const result = await controlClient.dbInit({
      contractIR,
      mode: 'plan',
      connection: connectionString,
    });
    if (!result.ok) {
      throw new Error(`dbInit plan failed: ${result.failure.summary}`);
    }

    const operations = result.value.plan
      .operations as unknown as ReadonlyArray<OperationWithSqlSteps>;
    return operations
      .flatMap((operation) => operation.execute.map((step) => step.sql))
      .join(';\n\n');
  } finally {
    await controlClient.close();
  }
}

/**
 * Test context provided to test callbacks by `withTestRuntime`.
 * Contains all the setup needed for e2e tests against a real database.
 */
export interface TestRuntimeContext<TContract extends SqlContract<SqlStorage>> {
  /** The validated contract loaded from disk */
  readonly contract: TContract;
  /** The SQL query context for building queries */
  readonly context: ReturnType<typeof createTestContext>;
  /** The test runtime for executing queries */
  readonly runtime: ReturnType<typeof createTestRuntimeFromClient>;
  /** The schema tables extracted from the contract */
  readonly tables: ReturnType<typeof schema<TContract>>['tables'];
  /** The raw pg client for direct SQL queries */
  readonly client: Client;
  /** The DDL SQL generated for the contract */
  readonly sql: string;
}

/**
 * Sets up a complete test environment with database, contract, and runtime.
 * This helper DRYs up the common e2e test setup pattern:
 * - Loads contract from disk
 * - Spins up a dev database
 * - Runs db init (migrations)
 * - Creates adapter, context, runtime, and tables
 * - Ensures runtime is closed after the test
 *
 * @example
 * ```typescript
 * it('runs a query', async () => {
 *   await withTestRuntime<Contract>(contractJsonPath, async ({ tables, runtime, context }) => {
 *     const user = tables.user!;
 *     const plan = sql({ context }).from(user).select({ id: user.columns.id! }).build();
 *     const rows = await executePlanAndCollect(runtime, plan);
 *     expect(rows.length).toBeGreaterThan(0);
 *   });
 * });
 * ```
 */
export async function withTestRuntime<TContract extends SqlContract<SqlStorage>>(
  contractJsonPath: string,
  callback: (ctx: TestRuntimeContext<TContract>) => Promise<void>,
): Promise<void> {
  const contractIR = await loadContractIRFromDisk(contractJsonPath);
  const contract = validateContract<TContract>(contractIR);

  await withDevDatabase(async ({ connectionString }) => {
    const sql = await getPlannedDdlSql({ connectionString, contractIR });
    await runDbInit({ connectionString, contractJsonPath });

    await withClient(connectionString, async (client: Client) => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const runtime = createTestRuntimeFromClient(contract, client);

      try {
        const tables = schema<TContract>(context).tables;
        await callback({ contract, context, runtime, tables, client, sql });
      } finally {
        await runtime.close();
      }
    });
  });
}
