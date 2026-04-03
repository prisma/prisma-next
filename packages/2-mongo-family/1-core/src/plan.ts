import type { PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoWireCommand } from './wire-commands';

export interface MongoExecutionPlan<Row = unknown> {
  readonly wireCommand: AnyMongoWireCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}
