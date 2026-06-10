import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type {
  MigrationPlanOperation,
  OpFactoryCall,
} from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import { isThenable } from '@prisma-next/utils/promise';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Asserts an op materialised by an `OpFactoryCall` targets postgres. The
 * extension surface lets any contributor emit calls, so this is the
 * integration boundary where a stray non-postgres op would otherwise
 * silently flow through to postgres-shaped renderers — exactly the
 * place to fail loudly with op metadata (`id` + `target.id`).
 */
function assertPostgresOp(op: MigrationPlanOperation, callFactoryName: string): asserts op is Op {
  const targetId = (op as Partial<Op>).target?.id;
  if (targetId !== 'postgres') {
    throw new Error(
      `renderOps: expected postgres op but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${callFactoryName}"). An OpFactoryCall produced an op for a different target on the postgres planner path; check the call's target binding.`,
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
      'PG OpFactoryCall.toOp accepts an optional ExecuteRequestLowerer; the framework interface omits it because not all targets need a lowerer — the PG target overrides with this extended signature'
    >(c).toOp(lowerer);
    if (isThenable(opOrPromise)) {
      return opOrPromise.then((op) => {
        assertPostgresOp(op, c.factoryName);
        return op;
      });
    }
    assertPostgresOp(opOrPromise, c.factoryName);
    return opOrPromise;
  });
}
