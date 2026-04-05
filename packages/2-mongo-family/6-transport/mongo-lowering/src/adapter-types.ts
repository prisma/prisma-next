import type { PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

export interface MongoQueryPlanLike {
  readonly collection: string;
  readonly command: { readonly kind: string; readonly collection: string };
  readonly meta: PlanMeta;
}

export interface MongoAdapter {
  lower(plan: MongoQueryPlanLike): AnyMongoWireCommand;
}
