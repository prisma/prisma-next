import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { DdlDriverLowerer } from '@prisma-next/family-sql/control-adapter';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: DdlDriverLowerer,
): (Op | Promise<Op>)[] {
  return calls.map(
    (c) =>
      blindCast<
        { toOp(lowerer?: DdlDriverLowerer): Op | Promise<Op> },
        'SQLite OpFactoryCall.toOp accepts an optional DdlDriverLowerer; the framework interface omits it because not all targets need a lowerer — the SQLite target overrides with this extended signature'
      >(c).toOp(lowerer) as Op | Promise<Op>,
  );
}
