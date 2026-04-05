import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

export interface MongoAdapter {
  lower(plan: MongoQueryPlan): AnyMongoWireCommand;
}
