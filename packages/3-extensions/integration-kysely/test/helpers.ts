import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { CompiledQuery } from 'kysely';

export function createTestContract(overrides: Partial<ContractBase> = {}): ContractBase {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test' as ContractBase['storageHash'],
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

export function createCompiledQuery<Row>(
  sql: string,
  parameters: readonly unknown[] = [],
): CompiledQuery<Row> {
  return {
    query: {} as never,
    queryId: {} as never,
    sql,
    parameters: [...parameters],
  } as unknown as CompiledQuery<Row>;
}

export function createAsyncResult<Row>(rows: readonly Row[]): AsyncIterableResult<Row> {
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    for (const row of rows) {
      yield row;
    }
  };

  return new AsyncIterableResult(generator());
}

export interface RuntimeExecution<Row = Record<string, unknown>> {
  readonly plan: ExecutionPlan<Row>;
  readonly rows: readonly Row[];
}
