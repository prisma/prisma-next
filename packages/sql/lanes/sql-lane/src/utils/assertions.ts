import { planInvalid } from '@prisma-next/plan';

/**
 * Asserts that a ColumnBuilder has table and column properties.
 * Used after type casts when TypeScript can't narrow properly.
 */
export function assertColumnBuilder(
  col: { table?: string; column?: string },
  context: string,
): asserts col is { table: string; column: string } {
  if (!col.table || !col.column) {
    throw planInvalid(`ColumnBuilder missing table/column in ${context}`);
  }
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
