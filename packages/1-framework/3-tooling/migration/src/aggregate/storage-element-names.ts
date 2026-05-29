import type { Contract } from '@prisma-next/contract/types';
import { elementCoordinates, type Storage } from '@prisma-next/framework-components/ir';

/**
 * Extract the set of top-level storage element names a contract claims.
 *
 * Used by the aggregate loader's disjointness check, by
 * `projectSchemaToSpace`'s "names owned by other members" walk, and by
 * the aggregate verifier's orphan-element detection.
 *
 * A contract's `storage` is typed `StorageBase` (hash only); the
 * framework `elementCoordinates` walk needs the fuller `Storage` shape
 * carrying the `namespaces` map. `hasNamespaceMap` narrows to that shape
 * at runtime via a type predicate, so the walk needs no cast — storage
 * without a namespace map (malformed or partially-constructed) yields
 * the empty set.
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

function hasNamespaceMap(storage: unknown): storage is Storage {
  if (typeof storage !== 'object' || storage === null) return false;
  if (!('namespaces' in storage)) return false;
  const { namespaces } = storage;
  if (typeof namespaces !== 'object' || namespaces === null || Array.isArray(namespaces)) {
    return false;
  }
  // elementCoordinates walks each namespace via Object.entries(ns), which
  // throws on a null value. A validated contract never carries a null
  // namespace, but this helper accepts arbitrary runtime shapes; require
  // every entry to be a non-null object so the walk cannot throw.
  return Object.values(namespaces).every(
    (ns) => typeof ns === 'object' && ns !== null && !Array.isArray(ns),
  );
}
