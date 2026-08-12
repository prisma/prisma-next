import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';

export interface MongoQueryExecutor {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
}
