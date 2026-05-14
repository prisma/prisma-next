import { SqlEnumType } from './sql-enum-type';
import { StorageTypeInstance } from './storage-type-instance';

/**
 * Transient codec-typed view of `SqlStorage.types` used by R1a code
 * paths that pre-date the per-IR enum walks.
 *
 * Decision 18 (Option B) lets `storage.types[name]` hold either a
 * `StorageTypeInstance` (codec-typed) or a `SqlEnumType` subclass
 * instance (e.g. `PostgresEnumType`). Verifier and planner code paths
 * lift to per-IR enum walks in R1b; until then this helper synthesises
 * a `StorageTypeInstance` view of an enum entry (using its
 * `codecBinding`) so the existing `(codecId, nativeType, typeParams)`
 * dispatch paths continue to work without target-specific awareness.
 *
 * The synthesised view is deliberately lossy — the per-IR walks in
 * R1b will read enum entries directly off `SqlEnumType` and never go
 * through this helper. Treating it as a temporary scaffolding makes
 * the R1b removal clean (delete the function, callers are then
 * forced to dispatch on `instanceof SqlEnumType`).
 */
export function asCodecTypedStorageTypes(
  types: Readonly<Record<string, StorageTypeInstance | SqlEnumType>> | undefined,
): Readonly<Record<string, StorageTypeInstance>> {
  if (types === undefined) {
    return {};
  }
  const out: Record<string, StorageTypeInstance> = {};
  for (const [name, entry] of Object.entries(types)) {
    out[name] =
      entry instanceof SqlEnumType
        ? new StorageTypeInstance({
            codecId: entry.codecBinding.codecId,
            nativeType: entry.nativeType,
            typeParams: entry.codecBinding.typeParams as Record<string, unknown>,
          })
        : entry;
  }
  return out;
}
