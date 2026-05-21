import type { IncludeExpr } from './types';

/**
 * Recursive predicate: does any include in the tree carry a scalar
 * selector (`count` / `sum` / ...) or a `combine()` descriptor?
 *
 * Such shapes cannot be lowered into the lateral / correlated
 * single-query strategies (TML-2595). The dispatch path uses this
 * to gate the whole tree to multi-query at any depth; the planner
 * (`compileSelectWithIncludeStrategy`) uses the same predicate to
 * fail fast at the boundary rather than build a malformed plan.
 * Without the recursion, a depth-2+ row include containing a
 * depth-3 `count()` would fall through to the planner and hit its
 * explicit `throw` instead of routing to multi-query.
 */
export function hasScalarOrCombineIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some(
    (include) =>
      include.scalar !== undefined ||
      include.combine !== undefined ||
      hasScalarOrCombineIncludeDescriptors(include.nested.includes),
  );
}
