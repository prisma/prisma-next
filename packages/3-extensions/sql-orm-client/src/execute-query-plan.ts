import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { RuntimeScope } from '@prisma-next/sql-relational-core/types';

export function executeQueryPlan<Row>(
  scope: RuntimeScope,
  plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
): AsyncIterableResult<Row> {
  return scope.execute(plan);
}
