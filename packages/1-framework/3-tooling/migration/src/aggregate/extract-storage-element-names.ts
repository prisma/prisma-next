/**
 * Extract the set of top-level storage element names a contract claims.
 *
 * Used by the aggregate loader's disjointness check and by
 * `projectSchemaToSpace`'s "names owned by other members" walk.
 *
 * **Stopgap — known layering violation.** This helper duck-types the
 * storage shape (`storage.tables` for SQL families, `storage.collections`
 * for Mongo) from framework-domain code that has no business naming
 * family-specific storage idioms. The framework lacks a typed primitive
 * for storage *topology* — the structural backbone of "what named things
 * does this contract claim?" independent of what those things are.
 *
 * The correct fix introduces that primitive at the framework level
 * (`interface Storage { readonly namespaces: Record<string, Namespace> }`
 * and friends), with each family's storage type required to conform.
 * That work is scoped in TML-2459 (target-extensible-ir) M1; TML-2459's
 * M2 R2 plan explicitly schedules removal of this duck-typed walk when
 * the IR class flip rebases onto this PR. Landing an interim typed shape
 * here would create a third on-disk shape that TML-2459 would have to
 * migrate away from again — violating its NFR1 ("no dual-shape
 * transition window").
 *
 * Behavioural notes for the lifetime of this helper:
 *
 * - Both `tables` and `collections` are unioned (a hypothetical
 *   cross-family contract exposing both would contribute both sets).
 * - Unrecognised storage shapes return an empty set, so a future family
 *   with a different layout silently disables disjointness rather than
 *   hard-failing. This is a stopgap default; the typed `Storage` shape
 *   in TML-2459 will replace it with a compile-time guarantee.
 * - Record-shape detection excludes arrays so array-shaped values aren't
 *   walked as records via numeric keys.
 * - Names that appear in both `tables` and `collections` are deduplicated
 *   by the returned `Set`.
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
