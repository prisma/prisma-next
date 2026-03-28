import type { DocumentContract } from '@prisma-next/contract/types';
import type { MongoExecutionPlan, MongoQueryPlan } from './plan';

export interface MongoLoweringContext {
  readonly contract: DocumentContract;
}

export interface MongoAdapter {
  lower<Row>(
    queryPlan: MongoQueryPlan<Row>,
    context: MongoLoweringContext,
  ): MongoExecutionPlan<Row>;
}
