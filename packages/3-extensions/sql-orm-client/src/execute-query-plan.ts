import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

interface QueryPlanExecutor {
  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row>;
}

export function executeQueryPlan<Row>(
  executor: QueryPlanExecutor,
  plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
): AsyncIterableResult<Row> {
  return executor.execute(plan);
}
