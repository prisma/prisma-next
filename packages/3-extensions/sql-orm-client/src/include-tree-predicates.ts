import type { IncludeExpr } from './types';

/**
 * Recursive predicate: does any include in the tree carry a scalar
 * selector (`count` / `sum` / ...) or a `combine()` descriptor?
 *
 * Historically the single gate that routed scalar/combine includes to
 * the multi-query stitcher (TML-2595). The two sibling predicates
 * below now carry the strategy-aware carve-out: the lateral builder
 * handles scalar reducers in a single LATERAL JOIN, while combine
 * still routes to multi-query under any strategy. This predicate
 * remains available for callers that want the union of "anything the
 * single-query planner did not historically handle."
 */
export function hasScalarOrCombineIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some(
    (include) =>
      include.scalar !== undefined ||
      include.combine !== undefined ||
      hasScalarOrCombineIncludeDescriptors(include.nested.includes),
  );
}

/**
 * Recursive predicate: does any include in the tree carry a scalar
 * selector (`count` / `sum` / ...)?
 *
 * The lateral builder lowers scalar at any depth into a single LATERAL
 * JOIN; the correlated builder does not currently emit scalar shapes.
 * The dispatch gate combines this predicate with the active strategy
 * to decide whether a tree must fall back to multi-query.
 */
export function hasScalarIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some(
    (include) =>
      include.scalar !== undefined || hasScalarIncludeDescriptors(include.nested.includes),
  );
}

/**
 * Recursive predicate: does any include in the tree carry a
 * `combine()` descriptor?
 *
 * Neither single-query builder lowers `combine()` yet, so the
 * dispatch gate routes any tree carrying a combine at any depth to
 * the multi-query stitcher (TML-2595 closes the lateral half;
 * the correlated half is tracked alongside).
 */
export function hasCombineIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some(
    (include) =>
      include.combine !== undefined || hasCombineIncludeDescriptors(include.nested.includes),
  );
}
