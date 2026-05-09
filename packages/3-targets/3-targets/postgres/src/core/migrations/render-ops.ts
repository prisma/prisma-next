import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Lower a list of `OpFactoryCall` IR nodes to their runtime ops.
 *
 * Accepts the framework `OpFactoryCall` interface so codec-emitted Calls
 * (e.g. cipherstash `*Call` classes) can flow through unchanged. Codec
 * contributions targeted this lane by construction — the planner only
 * inlines hooks for the postgres adapter — so we re-specialize the
 * framework-level `MigrationPlanOperation` back to the postgres-typed
 * `Op` at this trust boundary.
 */
export function renderOps(calls: readonly OpFactoryCall[]): Op[] {
  return calls.map((c) => c.toOp() as Op);
}
