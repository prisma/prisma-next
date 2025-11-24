import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { AnyPredicateBuilder, BinaryBuilder, LogicalBuilder } from './types';

/**
 * Creates a LogicalBuilder with and()/or() methods for chaining.
 */
function createLogicalBuilder(
  op: 'and' | 'or',
  left: BinaryBuilder | LogicalBuilder,
  right: AnyPredicateBuilder,
): LogicalBuilder {
  return Object.freeze({
    kind: 'logical' as const,
    op,
    left,
    right,
    and(expr: AnyPredicateBuilder): LogicalBuilder {
      return createLogicalBuilder('and', this, expr);
    },
    or(expr: AnyPredicateBuilder): LogicalBuilder {
      return createLogicalBuilder('or', this, expr);
    },
  }) as LogicalBuilder;
}

/**
 * Adds and()/or() methods to a BinaryBuilder.
 */
export function addLogicalMethodsToBinaryBuilder<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType,
>(
  binary: BinaryBuilder<ColumnName, ColumnMeta, JsType>,
): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
  return Object.freeze({
    ...binary,
    and(expr: AnyPredicateBuilder): LogicalBuilder {
      return createLogicalBuilder('and', binary, expr);
    },
    or(expr: AnyPredicateBuilder): LogicalBuilder {
      return createLogicalBuilder('or', binary, expr);
    },
  }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
}
