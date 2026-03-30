import type { ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst } from './ast/types';

/**
 * SQL query plan produced by lanes before lowering.
 *
 * Lanes build ASTs and metadata but do not perform SQL lowering.
 * The `sql` field is absent - lowering happens in the runtime executor.
 *
 * Structurally aligns with ExecutionPlan<Row, AnyQueryAst> (without sql field) to maintain
 * compatibility with ExecutionPlan/Plan-based utilities.
 * The generic parameter `_Row` is preserved for type extraction via ResultType.
 */
export interface SqlQueryPlan<_Row = unknown>
  extends Pick<ExecutionPlan<_Row, AnyQueryAst>, 'params' | 'meta'> {
  readonly ast: AnyQueryAst;
  // Phantom property to preserve generic parameter for type extraction
  // This allows ResultType to extract _Row for SqlQueryPlan values.
  readonly _Row?: _Row;
}

/**
 * Augments the last ParamDescriptor in the array with codecId and nativeType from columnMeta.
 * This is used when building WHERE expressions to ensure param descriptors have type information.
 */
export function augmentDescriptorWithColumnMeta(
  descriptors: ParamDescriptor[],
  columnMeta: StorageColumn | undefined,
): void {
  const descriptor = descriptors[descriptors.length - 1];
  if (descriptor && columnMeta) {
    descriptors[descriptors.length - 1] = {
      ...descriptor,
      codecId: columnMeta.codecId,
      nativeType: columnMeta.nativeType,
    };
  }
}
