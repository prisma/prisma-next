import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoReadStage } from './stages';

declare const __mongoReadPlanRow: unique symbol;

export interface MongoReadPlan<Row = unknown> {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoReadStage>;
  readonly meta: PlanMeta;
  readonly [__mongoReadPlanRow]?: Row;
}
