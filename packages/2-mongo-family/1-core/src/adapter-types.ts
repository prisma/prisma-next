import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoContract } from './contract-types';
import type { AggregateWireCommand, AnyMongoWireCommand } from './wire-commands';

export interface MongoLoweringContext {
  readonly contract: MongoContract;
}

export interface MongoReadPlanLike {
  readonly collection: string;
  readonly stages: ReadonlyArray<{ readonly kind: string }>;
  readonly meta: PlanMeta;
}

export interface MongoCommandLike {
  readonly kind: string;
  readonly collection: string;
}

export interface MongoAdapter {
  lowerCommand(command: MongoCommandLike, context: MongoLoweringContext): AnyMongoWireCommand;
  lowerReadPlan(plan: MongoReadPlanLike): AggregateWireCommand;
}
