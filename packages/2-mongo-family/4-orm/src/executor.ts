import type { PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoCommand, MongoReadPlan } from '@prisma-next/mongo-query-ast';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoQueryExecutor {
  execute<Row>(plan: MongoReadPlan<Row>): AsyncIterableResult<Row>;
  executeCommand<Row>(command: AnyMongoCommand, meta: PlanMeta): AsyncIterableResult<Row>;
}
