import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { QueryAst } from './ast/types';

/**
 * SQL query plan produced by lanes before lowering.
 *
 * Lanes build ASTs and metadata but do not perform SQL lowering.
 * The `sql` field is absent - lowering happens in the runtime executor.
 *
 * Structurally aligns with ExecutionPlan<Row, QueryAst> (without sql field) to maintain
 * compatibility with ExecutionPlan/Plan-based utilities.
 * The generic parameter `_Row` is preserved for type extraction via ResultType.
 */
export interface SqlQueryPlan<_Row = unknown>
  extends Pick<ExecutionPlan<_Row, QueryAst>, 'params' | 'meta'> {
  readonly ast: QueryAst;
  // Phantom property to preserve generic parameter for type extraction
  // This allows ResultType to extract _Row for SqlQueryPlan values.
  readonly _Row?: _Row;
}
