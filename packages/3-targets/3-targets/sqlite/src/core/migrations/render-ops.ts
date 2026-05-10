import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export function renderOps(calls: readonly OpFactoryCall[]): Op[] {
  // Each call's `toOp()` is typed as the framework `MigrationPlanOperation`;
  // every concrete Call class on the sqlite planner path produces an op
  // whose `target.details` is `SqlitePlanTargetDetails`-shaped (or whose
  // `target.details` is absent, which is structurally compatible). The
  // narrowing cast happens at this single integration boundary instead of
  // poisoning every caller's type.
  return calls.map((c) => c.toOp() as Op);
}
