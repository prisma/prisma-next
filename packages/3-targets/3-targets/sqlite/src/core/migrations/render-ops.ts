import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type {
  MigrationPlanOperation,
  OpFactoryCall,
} from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import { isThenable } from '@prisma-next/utils/promise';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

function assertSqliteOp(op: MigrationPlanOperation, callFactoryName: string): asserts op is Op {
  const targetId = (op as Partial<Op>).target?.id;
  if (targetId !== 'sqlite') {
    throw new Error(
      `renderOps: expected sqlite op but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${callFactoryName}"). An OpFactoryCall produced an op for a different target on the sqlite planner path; check the call's target binding.`,
    );
  }
}

export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: ExecuteRequestLowerer,
): (Op | Promise<Op>)[] {
  return calls.map((c) => {
    const opOrPromise = blindCast<
      { toOp(lowerer?: ExecuteRequestLowerer): Op | Promise<Op> },
      'SQLite OpFactoryCall.toOp accepts an optional ExecuteRequestLowerer; the framework interface omits it because not all targets need a lowerer — the SQLite target overrides with this extended signature'
    >(c).toOp(lowerer);
    if (isThenable(opOrPromise)) {
      return opOrPromise.then((op) => {
        assertSqliteOp(op, c.factoryName);
        return op;
      });
    }
    assertSqliteOp(opOrPromise, c.factoryName);
    return opOrPromise;
  });
}
