/**
 * Extract the set of top-level storage element names a contract claims.
 *
 * Used by the aggregate loader's disjointness check and by
 * `projectSchemaToSpace`'s "names owned by other members" walk. Centralising
 * the walk here keeps the duck-typed shape detection in one place and gives
 * both call sites the same fall-through semantics.
 *
 * Duck-typed across the storage shapes used in this codebase today:
 *
 * - SQL families: `storage.tables: Record<string, ...>` → table names.
 * - Mongo: `storage.collections: Record<string, ...>` → collection names.
 *
 * Both shapes are unioned: a contract that exposed both (a hypothetical
 * cross-family shape) would contribute both sets. Returns an empty set for
 * any other shape, so a future family with a different storage layout gets
 * disjointness effectively disabled (not enforced) rather than a hard
 * failure — the same fall-through guarantee as `projectSchemaToSpace`.
 *
 * Record-shape detection excludes arrays (`!Array.isArray`) so an
 * unrecognised array-shaped value falls through unchanged rather than
 * being walked as a record via numeric keys. Elements that appear in both
 * `tables` and `collections` (a hypothetical cross-family shape) are
 * deduplicated by the returned `Set`, so neither call site sees a name
 * twice.
 */
export function extractStorageElementNames(contract: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof contract !== 'object' || contract === null) return names;
  const storage = (contract as { readonly storage?: unknown }).storage;
  if (typeof storage !== 'object' || storage === null) return names;
  const storageObj = storage as { readonly tables?: unknown; readonly collections?: unknown };
  for (const field of ['tables', 'collections'] as const) {
    const value = storageObj[field];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const name of Object.keys(value as Record<string, unknown>)) {
        names.add(name);
      }
    }
  }
  return names;
}
