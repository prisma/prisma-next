import type { Contract } from '@prisma-next/contract/types';
import { elementCoordinates, type Storage } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';

/**
 * Extract the set of top-level storage element names a contract claims.
 *
 * Used by the aggregate loader's disjointness check, by
 * `projectSchemaToSpace`'s "names owned by other members" walk, and by
 * the aggregate verifier's orphan-element detection.
 */
export function storageElementNames(contract: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof contract !== 'object' || contract === null) return names;

  const storage = (contract as Contract).storage;
  if (!hasNamespaceMap(storage)) return names;

  for (const coordinate of elementCoordinates(
    blindCast<Storage, 'Loader-boundary contract storage is Storage-shaped'>(storage),
  )) {
    names.add(coordinate.entityName);
  }
  return names;
}

function hasNamespaceMap(
  storage: unknown,
): storage is Contract['storage'] & { readonly namespaces: Storage['namespaces'] } {
  if (typeof storage !== 'object' || storage === null) return false;
  const namespaces = (storage as { readonly namespaces?: unknown }).namespaces;
  return typeof namespaces === 'object' && namespaces !== null && !Array.isArray(namespaces);
}
