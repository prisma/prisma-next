import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { SqliteOpFactoryCall } from './op-factory-call';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export function renderOps(calls: readonly SqliteOpFactoryCall[]): Op[] {
  return calls.map((c) => c.toOp());
}
