import type { MongoReadPlan } from '@prisma-next/mongo-query-ast';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoQueryExecutor {
  execute<Row>(plan: MongoReadPlan<Row>): AsyncIterableResult<Row>;
}
