import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { QueryPlan } from '@prisma-next/framework-components/runtime';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst } from './ast/types';

/**
 * SQL query plan produced by lanes before lowering.
 *
 * Lanes build ASTs and metadata but do not perform SQL lowering. The `sql`
 * field is absent — `RuntimeCore` (the runtime base class in
 * `@prisma-next/framework-components/runtime`) drives lowering via the
 * SQL adapter and produces a `SqlExecutionPlan`.
 *
 * Extends the framework-level `QueryPlan<Row>` marker (`meta + _row`) and
 * adds SQL-specific fields (`ast`, `params`). The phantom `_row` property
 * (inherited from `QueryPlan`) is what `ResultType<P>` inspects to recover
 * the row type.
 */
export interface SqlQueryPlan<Row = unknown> extends QueryPlan<Row> {
  readonly ast: AnyQueryAst;
  readonly params: readonly unknown[];
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
