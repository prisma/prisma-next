import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { PostgresOpFactoryCall } from './op-factory-call';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

export function renderOps(calls: readonly PostgresOpFactoryCall[]): Op[] {
  return calls.map((c) => c.toOp());
}
