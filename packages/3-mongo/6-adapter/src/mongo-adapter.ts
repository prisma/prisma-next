import type { MongoExecutionPlan, MongoQueryPlan } from '@prisma-next/mongo-core';

export type MongoLoweringContext = {};

export interface MongoAdapter {
  lower<Row>(
    queryPlan: MongoQueryPlan<Row>,
    context: MongoLoweringContext,
  ): MongoExecutionPlan<Row>;
}

export function createMongoAdapter(): MongoAdapter {
  return {
    lower: () => {
      throw new Error('not implemented');
    },
  };
}
