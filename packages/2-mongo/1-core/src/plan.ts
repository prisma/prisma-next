import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoCommand } from './commands';
import type { MongoWireCommand } from './wire-commands';

export interface MongoQueryPlan<Row = unknown> {
  readonly command: MongoCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}

export interface MongoExecutionPlan<Row = unknown> {
  readonly wireCommand: MongoWireCommand;
  readonly command: MongoCommand;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}
