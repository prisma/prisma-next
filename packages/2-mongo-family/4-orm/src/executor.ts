import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoQueryExecutor {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
}
