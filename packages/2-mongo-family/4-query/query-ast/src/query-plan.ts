import type { PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoCommand } from './commands';

declare const __mongoQueryPlanRow: unique symbol;

export interface MongoQueryPlan<Row = unknown> {
  readonly collection: string;
  readonly command: AnyMongoCommand;
  readonly meta: PlanMeta;
  readonly [__mongoQueryPlanRow]?: Row;
}
