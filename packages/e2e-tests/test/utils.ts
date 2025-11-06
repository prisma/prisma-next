import {
  withDevDatabase,
  withClient,
  executePlanAndCollect as executePlanAndCollectBase,
  loadContractFromDisk as loadContractFromDiskBase,
  emitAndVerifyContract as emitAndVerifyContractBase,
  setupE2EDatabase as setupE2EDatabaseBase,
  type ContractMarkerStatements,
} from '@prisma-next/test-utils';
import { ensureSchemaStatement, ensureTableStatement, writeContractMarker } from '@prisma-next/runtime';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { Client } from 'pg';
import type { Adapter, SelectAst, LoweredStatement, Plan, ResultType } from '@prisma-next/sql-query/types';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { createRuntime } from '@prisma-next/runtime';
import type { Plugin, Log } from '@prisma-next/runtime';
import type { SqlDriver } from '@prisma-next/sql-target';

export { withDevDatabase, withClient };

export async function executePlanAndCollect<P extends Plan>(
  runtime: { execute<Row = Record<string, unknown>>(plan: unknown): AsyncIterable<Row> },
  plan: P,
): Promise<ResultType<P>[]> {
  return executePlanAndCollectBase(runtime, plan) as Promise<ResultType<P>[]>;
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

export async function loadContractFromDisk<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>(
  contractJsonPath: string,
): Promise<TContract> {
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
  const verify: { mode: 'onFirstUse' | 'startup' | 'always'; requireMarker: boolean } =
    options?.verify
      ? { ...options.verify, requireMarker: options.verify.requireMarker ?? false }
      : { mode: 'onFirstUse', requireMarker: true };
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

