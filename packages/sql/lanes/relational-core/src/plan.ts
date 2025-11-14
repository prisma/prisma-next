import type { Plan } from '@prisma-next/contract/types';
import type { QueryAst } from './ast/types';

/**
 * SQL query plan produced by lanes before lowering.
 *
 * Lanes build ASTs and metadata but do not perform SQL lowering.
 * The `sql` field is absent - lowering happens in the runtime executor.
 *
 * Extends Plan (without sql field) to maintain compatibility with Plan-based utilities.
 * The generic parameter `_Row` is preserved for type extraction via ResultType.
 */
export interface SqlQueryPlan<_Row = unknown> extends Omit<Plan<_Row>, 'sql' | 'ast'> {
  readonly ast: QueryAst;
  // Phantom property to preserve generic parameter for type extraction
  // This allows ResultType to extract _Row even when SqlQueryPlan extends Omit<Plan<_Row>, ...>
  readonly _Row?: _Row;
}
