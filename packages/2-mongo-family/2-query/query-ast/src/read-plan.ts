import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoReadStage } from './stages';

export interface MongoReadPlan<Row = unknown> {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoReadStage>;
  readonly meta: PlanMeta;
  readonly _row?: Row;
}
