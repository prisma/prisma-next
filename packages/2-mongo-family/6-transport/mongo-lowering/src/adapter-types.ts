import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

export interface MongoAdapter {
  lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>;
}
