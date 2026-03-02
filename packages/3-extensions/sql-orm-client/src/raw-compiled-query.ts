import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { CompiledQuery } from 'kysely';

interface ExecuteCompiledQueryOptions {
  readonly lane?: string;
}

interface CompiledQueryExecutor {
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row>;
}

export function executeCompiledQuery<Row>(
  executor: CompiledQueryExecutor,
  contract: ContractBase,
  compiledQuery: CompiledQuery<Row>,
  options: ExecuteCompiledQueryOptions = {},
): AsyncIterableResult<Row> {
  return executor.execute({
    ast: undefined,
    sql: compiledQuery.sql,
    params: compiledQuery.parameters,
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storageHash,
      ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
      lane: options.lane ?? 'raw',
      paramDescriptors: [],
    },
  });
}
