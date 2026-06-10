import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { Lowerer } from '@prisma-next/family-sql/control-adapter';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export function renderOps(calls: readonly OpFactoryCall[], lowerer?: Lowerer): Op[] {
  // Each call's `toOp()` is typed as the framework `MigrationPlanOperation`;
  // every concrete Call class on the sqlite planner path produces an op
  // whose `target.details` is `SqlitePlanTargetDetails`-shaped (or whose
  // `target.details` is absent, which is structurally compatible). The
  // narrowing cast happens at this single integration boundary instead of
  // poisoning every caller's type.
  return calls.map(
    (c) =>
      blindCast<
        { toOp(lowerer?: Lowerer): ReturnType<OpFactoryCall['toOp']> },
        'SQLite OpFactoryCall.toOp accepts an optional Lowerer; the framework interface omits it because not all targets need a lowerer — the SQLite target overrides with this extended signature'
      >(c).toOp(lowerer) as Op,
  );
}
