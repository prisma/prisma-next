import {
  createDevDatabase,
  withDevDatabase,
  withClient,
  executeStatement,
  drainAsyncIterable,
  collectAsync,
  executePlanAndCollect as executePlanAndCollectBase,
  drainPlanExecution,
  setupTestDatabase as setupTestDatabaseBase,
  teardownTestDatabase,
  writeTestContractMarker as writeTestContractMarkerBase,
  loadContractFromDisk as loadContractFromDiskBase,
  emitAndVerifyContract as emitAndVerifyContractBase,
  setupE2EDatabase as setupE2EDatabaseBase,
  type DevDatabase,
  type ContractMarkerStatements,
} from '@prisma-next/test-utils';
import type { Plan, ResultType } from '@prisma-next/sql-query/types';
import {
  createRuntime,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/runtime';
import type { Plugin, Log } from '@prisma-next/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { SqlDriver } from '@prisma-next/sql-target';
import type { Adapter, SelectAst, LoweredStatement } from '@prisma-next/sql-query/types';
import { validateContract } from '@prisma-next/sql-query/schema';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { Client } from 'pg';

export {
  createDevDatabase,
  withDevDatabase,
  withClient,
  executeStatement,
  drainAsyncIterable,
  collectAsync,
  drainPlanExecution,
  teardownTestDatabase,
  type DevDatabase,
};

export async function executePlanAndCollect<P extends Plan | Record<string, unknown>>(
  runtime: { execute<Row = Record<string, unknown>>(plan: unknown): AsyncIterable<Row> },
  plan: P | Plan,
): Promise<P extends Plan ? ResultType<P>[] : P[]> {
  return executePlanAndCollectBase(runtime, plan) as unknown as P extends Plan
    ? ResultType<P>[]
    : P[];
}

export interface CreateTestRuntimeOptions {
  readonly verify?: { mode: 'onFirstUse' | 'startup' | 'always'; requireMarker?: boolean };
  readonly plugins?: readonly Plugin[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

const markerStatements: ContractMarkerStatements = {
  ensureSchema: ensureSchemaStatement,
  ensureTable: ensureTableStatement,
  writeMarker: writeContractMarker,
};

export async function setupTestDatabase(
  client: Client,
  contract: SqlContract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  return setupTestDatabaseBase(client, contract, setupFn, markerStatements);
}

export async function writeTestContractMarker(
  client: Client,
  contract: SqlContract<SqlStorage>,
): Promise<void> {
  return writeTestContractMarkerBase(client, contract, markerStatements);
}

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

export async function loadContractFromDisk<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
>(contractJsonPath: string): Promise<TContract> {
  return loadContractFromDiskBase<TContract>(contractJsonPath, validateContract);
}

export async function emitAndVerifyContract(
  cliPath: string,
  contractTsPath: string,
  adapterPath: string,
  outputDir: string,
  expectedContractJsonPath: string,
): Promise<SqlContract<SqlStorage>> {
  return emitAndVerifyContractBase(
    cliPath,
    contractTsPath,
    adapterPath,
    outputDir,
    expectedContractJsonPath,
    validateContract,
  ) as Promise<SqlContract<SqlStorage>>;
}

export async function setupE2EDatabase(
  client: Client,
  contract: SqlContract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  return setupE2EDatabaseBase(client, contract, setupFn, markerStatements);
}
