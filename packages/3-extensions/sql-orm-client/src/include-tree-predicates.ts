import type { IncludeExpr } from './types';

/**
 * Recursive predicate: does any include in the tree carry a
 * non-leaf `distinct()` — i.e. `nested.distinct` set on an include
 * whose `nested.includes` is non-empty?
 *
 * Such shapes cannot be lowered into the lateral / correlated
 * single-query strategies: the child SELECT would emit
 * `SELECT DISTINCT <scalars>, json_agg(<nested>) FROM ...`, and
 * Postgres rejects equality on `json`. The dispatch path routes
 * these to multi-query (which applies distinct to scalar-only rows
 * before grandchildren stitch in JS); the planner rejects them at
 * the boundary.
 *
 * `distinctOn` is intentionally not included: Postgres only
 * compares the `ON (...)` expressions for equality, so a hashable
 * key column plus json projections is well-defined.
 */
export function hasNonLeafIncludeWithDistinct(includes: readonly IncludeExpr[]): boolean {
  return includes.some(
    (include) =>
      (include.nested.distinct !== undefined &&
        include.nested.distinct.length > 0 &&
        include.nested.includes.length > 0) ||
      hasNonLeafIncludeWithDistinct(include.nested.includes),
  );
}
