import type { PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoCommand } from './commands';

declare const __mongoQueryPlanRow: unique symbol;

export interface MongoQueryPlan<Row = unknown, Command extends AnyMongoCommand = AnyMongoCommand> {
  readonly collection: string;
  readonly command: Command;
  readonly meta: PlanMeta;
  readonly [__mongoQueryPlanRow]?: Row;
}
