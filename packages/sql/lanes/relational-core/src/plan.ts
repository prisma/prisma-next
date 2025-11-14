import type { PlanMeta } from '@prisma-next/contract/types';
import type { QueryAst } from './ast/types';

/**
 * SQL query plan produced by lanes before lowering.
 *
 * Lanes build ASTs and metadata but do not perform SQL lowering.
 * The `sql` field is absent - lowering happens in the runtime executor.
 */
export interface SqlQueryPlan<_Row = unknown> {
  readonly ast: QueryAst;
  readonly params: readonly unknown[];
  readonly meta: PlanMeta;
}
