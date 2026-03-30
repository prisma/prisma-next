import type { PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoCommand } from './commands';
import type { AnyMongoWireCommand } from './wire-commands';

export interface MongoQueryPlan<Row = unknown> {
  readonly command: AnyMongoCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}

export interface MongoExecutionPlan<Row = unknown> {
  readonly wireCommand: AnyMongoWireCommand;
  readonly command: AnyMongoCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}
