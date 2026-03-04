import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { RuntimeScope } from './types';

export function executeQueryPlan<Row>(
  scope: RuntimeScope,
  plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
): AsyncIterableResult<Row> {
  return scope.execute(plan);
}
