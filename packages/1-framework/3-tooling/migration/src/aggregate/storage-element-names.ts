import type { Contract } from '@prisma-next/contract/types';
import { elementCoordinates, type Storage } from '@prisma-next/framework-components/ir';

/**
 * Extract the set of top-level storage element names a contract claims.
 *
 * Used by the aggregate loader's disjointness check, by
 * `projectSchemaToSpace`'s "names owned by other members" walk, and by
 * the aggregate verifier's orphan-element detection.
 *
 * `Contract.storage` is typed `StorageBase` in foundation (hash-only);
 * the `namespaces` map lives on framework `Storage`. Foundation cannot
 * import core, so `hasNamespaceMap` narrows `StorageBase → Storage`
 * at runtime — a layering type-bridge in lieu of a bare cast.
 */
export function storageElementNames(contract: Contract): Set<string> {
  const names = new Set<string>();
  const { storage } = contract;
  if (!hasNamespaceMap(storage)) return names;
  for (const coordinate of elementCoordinates(storage)) {
    names.add(coordinate.entityName);
  }
  return names;
}

// StorageBase omits namespaces; narrow to framework Storage at the layering seam.
function hasNamespaceMap(storage: unknown): storage is Storage {
  if (typeof storage !== 'object' || storage === null) return false;
  if (!('namespaces' in storage)) return false;
  const { namespaces } = storage;
  return typeof namespaces === 'object' && namespaces !== null && !Array.isArray(namespaces);
}
