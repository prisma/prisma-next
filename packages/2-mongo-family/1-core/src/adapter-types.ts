import type { MongoContract } from './contract-types';
import type { MongoExecutionPlan, MongoQueryPlan } from './plan';

export interface MongoLoweringContext {
  readonly contract: MongoContract;
}

export interface MongoAdapter {
  lower<Row>(
    queryPlan: MongoQueryPlan<Row>,
    context: MongoLoweringContext,
  ): MongoExecutionPlan<Row>;
}
