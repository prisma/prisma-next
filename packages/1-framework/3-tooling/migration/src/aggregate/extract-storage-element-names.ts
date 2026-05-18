/**
 * Extract the set of top-level storage element names a contract claims.
 *
 * Used by the aggregate loader's disjointness check and by
 * `projectSchemaToSpace`'s "names owned by other members" walk.
 *
 * **Stopgap — known layering violation.** This helper duck-types the
 * storage shape from framework-domain code that has no business naming
 * family-specific storage idioms. The framework lacks a typed primitive
 * for storage *topology* — the structural backbone of "what named things
 * does this contract claim?" independent of what those things are.
 *
 * Behavioural notes for the lifetime of this helper:
 *
 * - SQL contracts contribute table names from every
 *   `storage.namespaces[namespaceId].tables` map.
 * - Mongo contracts contribute names from each namespace's `tables`
 *   (or `collections`, depending on the per-target Namespace's slot
 *   choice). Per-namespace `collections` may appear as a record or as
 *   an array of `{ name }` entries; both are accepted defensively.
 * - Root-level `tables` / `collections` records (when present) are
 *   also unioned. These root-level walks are belt-and-suspenders for a
 *   defensive helper operating on `unknown`; no in-tree contract emits
 *   the root shape post-namespace flip.
 * - Unrecognised shapes contribute nothing beyond the walks above.
 * - Record-shape detection excludes arrays so array-shaped values aren't
 *   walked as records via numeric keys.
 * - Names that appear in multiple places are deduplicated by the returned
 *   `Set`.
 */
export function extractStorageElementNames(contract: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof contract !== 'object' || contract === null) return names;
  const storage = (contract as { readonly storage?: unknown }).storage;
  if (typeof storage !== 'object' || storage === null) return names;
  const storageObj = storage as {
    readonly namespaces?: unknown;
    readonly tables?: unknown;
    readonly collections?: unknown;
  };

  if (
    typeof storageObj.namespaces === 'object' &&
    storageObj.namespaces !== null &&
    !Array.isArray(storageObj.namespaces)
  ) {
    for (const ns of Object.values(storageObj.namespaces as Record<string, unknown>)) {
      if (typeof ns !== 'object' || ns === null) continue;
      const nsObj = ns as { readonly tables?: unknown; readonly collections?: unknown };
      addRecordKeys(nsObj.tables, names);
      if (Array.isArray(nsObj.collections)) {
        for (const entry of nsObj.collections) {
          if (typeof entry === 'object' && entry !== null) {
            const name = (entry as { readonly name?: unknown }).name;
            if (typeof name === 'string') names.add(name);
          }
        }
      } else {
        addRecordKeys(nsObj.collections, names);
      }
    }
  }

  addRecordKeys(storageObj.tables, names);
  addRecordKeys(storageObj.collections, names);
  return names;
}

function addRecordKeys(value: unknown, names: Set<string>): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const name of Object.keys(value as Record<string, unknown>)) {
      names.add(name);
    }
  }
}
