/**
 * Shared relational-diff types and semantic-satisfaction predicates. The
 * coordinate-based issue diff this module used to house (`collectSqlSchemaIssues`
 * / `collectSqlSchemaIssuesPerNamespace`) retired once the migration planner
 * took `plan(start, end)` over the one differ (`buildPostgresPlanDiff` /
 * `buildSqlitePlanDiff`); what remains here is consumed by the surviving
 * verify verdict (`schema-verify.ts`) and the control adapters.
 */

import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlIndexIR, SqlUniqueIR } from '@prisma-next/sql-schema-ir/types';

/**
 * Function type for normalizing raw database default expressions into ColumnDefault.
 * Target-specific implementations handle database dialect differences.
 */
export type DefaultNormalizer = (
  rawDefault: string,
  nativeType: string,
) => ColumnDefault | undefined;

/**
 * Function type for normalizing schema native types to canonical form for comparison.
 * Target-specific implementations handle dialect-specific type name variations
 * (e.g., Postgres 'varchar' → 'character varying', 'timestamptz' normalization).
 */
export type NativeTypeNormalizer = (nativeType: string) => string;

/**
 * Compares two arrays of strings for equality (order-sensitive).
 */
export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if a unique constraint requirement is satisfied by the given columns:
 * a unique constraint with the same columns, or a unique index with the same
 * columns (semantic satisfaction). Used by the planners to keep the
 * "stronger satisfies weaker" behavior consistent across the control plane.
 */
export function isUniqueConstraintSatisfied(
  uniques: readonly SqlUniqueIR[],
  indexes: readonly SqlIndexIR[],
  columns: readonly string[],
): boolean {
  const hasConstraint = uniques.some((unique) => arraysEqual(unique.columns, columns));
  if (hasConstraint) {
    return true;
  }
  return indexes.some((index) => index.unique && arraysEqual(index.columns, columns));
}

/**
 * Checks if an index requirement is satisfied by the given columns: any index
 * (unique or non-unique) with the same columns, or a unique constraint with
 * the same columns (stronger satisfies weaker).
 */
export function isIndexSatisfied(
  indexes: readonly SqlIndexIR[],
  uniques: readonly SqlUniqueIR[],
  columns: readonly string[],
): boolean {
  const hasMatchingIndex = indexes.some((index) => arraysEqual(index.columns, columns));
  if (hasMatchingIndex) {
    return true;
  }
  return uniques.some((unique) => arraysEqual(unique.columns, columns));
}
