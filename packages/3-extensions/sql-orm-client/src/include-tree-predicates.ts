import type { IncludeExpr } from './types';

/**
 * Recursive predicate: does any include in the tree carry a scalar
 * selector (`count` / `sum` / ...) or a `combine()` descriptor?
 *
 * Originally a single "must route to multi-query" gate (TML-2595);
 * the two sibling predicates below now carry the strategy-aware
 * carve-out (lateral handles scalar in a single LATERAL JOIN; combine
 * still routes to multi-query until D2 lands). This predicate remains
 * available for callers that want the union of "anything that the
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
 * The lateral builder now handles scalar at any depth (D1); the
 * correlated builder does not yet (D3). The dispatch gate combines
 * this with the strategy to decide whether a tree must fall back to
 * multi-query.
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
 * Neither the lateral nor the correlated builder handles combine yet
 * (D2 lifts lateral; D3 lifts correlated). The dispatch gate routes
 * any tree with a combine anywhere to multi-query.
 */
export function hasCombineIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some(
    (include) =>
      include.combine !== undefined || hasCombineIncludeDescriptors(include.nested.includes),
  );
}
