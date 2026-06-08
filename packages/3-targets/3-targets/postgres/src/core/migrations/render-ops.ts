import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { Lowerer } from '@prisma-next/family-sql/control-adapter';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Asserts an op materialised by an `OpFactoryCall` targets postgres. The
 * extension surface lets any contributor emit calls, so this is the
 * integration boundary where a stray non-postgres op would otherwise
 * silently flow through to postgres-shaped renderers — exactly the
 * place to fail loudly with op metadata (`id` + `target.id`).
 */
function assertPostgresOp(
  op: ReturnType<OpFactoryCall['toOp']>,
  callFactoryName: string,
): asserts op is Op {
  const targetId = (op as Partial<Op>).target?.id;
  if (targetId !== 'postgres') {
    throw new Error(
      `renderOps: expected postgres op but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${callFactoryName}"). An OpFactoryCall produced an op for a different target on the postgres planner path; check the call's target binding.`,
    );
  }
}

export function renderOps(calls: readonly OpFactoryCall[], lowerer?: Lowerer): Op[] {
  return calls.map((c) => {
    const op = blindCast<
      { toOp(lowerer?: Lowerer): ReturnType<OpFactoryCall['toOp']> },
      'PG OpFactoryCall.toOp accepts an optional Lowerer; the framework interface omits it because not all targets need a lowerer — the PG target overrides with this extended signature'
    >(c).toOp(lowerer);
    assertPostgresOp(op, c.factoryName);
    return op;
  });
}
