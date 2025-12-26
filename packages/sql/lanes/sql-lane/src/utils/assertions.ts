import { planInvalid } from '@prisma-next/plan';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';

/**
 * Asserts that a ColumnBuilder has table and column properties.
 */
export function assertColumnBuilder(col: unknown, context: string): AnyColumnBuilder {
  if (
    typeof col === 'object' &&
    col !== null &&
    'table' in col &&
    'column' in col &&
    typeof (col as { table: unknown }).table === 'string' &&
    typeof (col as { column: unknown }).column === 'string'
  ) {
    return col as AnyColumnBuilder;
  }
  throw planInvalid(`ColumnBuilder missing table/column in ${context}`);
}

/**
 * Asserts that a JoinOnPredicate has valid left and right columns.
 */
export function assertJoinOnPredicate(on: {
  left?: { table?: string; column?: string };
  right?: { table?: string; column?: string };
}): asserts on is {
  left: { table: string; column: string };
  right: { table: string; column: string };
} {
  if (!on.left?.table || !on.left?.column || !on.right?.table || !on.right?.column) {
    throw planInvalid('JoinOnPredicate missing required table/column properties');
  }
}
