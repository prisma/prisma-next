import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { CompiledQuery } from 'kysely';

export interface CompiledQueryExecutionOptions {
  readonly lane?: string;
}

export interface CompiledQueryExecutor {
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row>;
}

export function createExecutionPlanFromCompiledQuery<Row>(
  contract: ContractBase,
  compiledQuery: CompiledQuery<Row>,
  options: CompiledQueryExecutionOptions = {},
): ExecutionPlan<Row> {
  return {
    // TODO: convert Kysely AST into Prisma AST.
    ast: undefined,
    sql: compiledQuery.sql,
    params: compiledQuery.parameters,
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storageHash,
      ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
      lane: options.lane ?? 'raw',
      // TODO: fill in parameter descriptors from compiled query metadata.
      paramDescriptors: [],
    },
  };
}

export function executeCompiledQuery<Row>(
  executor: CompiledQueryExecutor,
  contract: ContractBase,
  compiledQuery: CompiledQuery<Row>,
  options: CompiledQueryExecutionOptions = {},
): AsyncIterableResult<Row> {
  return executor.execute(createExecutionPlanFromCompiledQuery(contract, compiledQuery, options));
}
