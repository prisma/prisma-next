import type { StorageHashBase } from '@prisma-next/contract/types';
import type { IRNode } from './ir-node';
import { isStoragePlaneReservedKey, storageNamespaceEntries } from './storage-plane-keys';

/**
 * Canonical address for a named entity in Contract IR / Schema IR.
 *
 * `plane` is `'domain' | 'storage'`: which top-level contract plane the
 * entity lives on. Domain-side walks (once domain content is populated)
 * yield `plane: 'domain'`; {@link elementCoordinates} over storage yields
 * `plane: 'storage'`. A sibling `elementCoordinates(domain)` is not wired
 * yet — domain-plane content lands in S1.C; the sibling walk lands there.
 *
 * Cross-plane references obey a directional invariant: domain → storage is
 * allowed; storage → domain is forbidden. That rule is enforced by a
 * separate validator, not by constraining this coordinate shape — the
 * coordinate carries the axis the validator checks.
 *
 * Iteration order over namespace properties follows `Object.entries` order;
 * consumers that depend on ordering must sort.
 */
export interface EntityCoordinate {
  readonly plane: 'domain' | 'storage';
  readonly namespaceId: string;
  readonly entityKind: string;
  readonly entityName: string;
}

/**
 * Lazy walk over every named storage entity in a `Storage`-shaped
 * value, yielded as {@link EntityCoordinate} tuples with
 * `plane: 'storage'` (the parameter type binds the plane).
 *
 * Iterates each namespace's own-enumerable properties structurally.
 * Skips reserved storage-plane keys (`storageHash`, `types`) and the
 * namespace scalar `id`. `kind` is non-enumerable on namespace
 * concretions and does not appear in `Object.entries`. For every other
 * property whose value is a non-null object, yields one coordinate per
 * entry key in that map. No family-specific slot vocabulary is required.
 */
export function* elementCoordinates(storage: Record<string, unknown>): Generator<EntityCoordinate> {
  for (const [namespaceId, ns] of storageNamespaceEntries(storage)) {
    for (const [entityKind, slot] of Object.entries(ns)) {
      if (entityKind === 'id') continue;
      if (isStoragePlaneReservedKey(entityKind)) continue;
      if (slot === null || typeof slot !== 'object') continue;
      for (const entityName of Object.keys(slot)) {
        yield { plane: 'storage', namespaceId, entityKind, entityName };
      }
    }
  }
}

/**
 * Framework-level promise that every Contract IR / Schema IR storage plane
 * carries a content hash and one or more namespace entries keyed directly
 * by namespace id (ADR 221 — no `namespaces` wrapper segment). Family
 * storage concretions (`SqlStorage`, `MongoStorage`) refine namespace
 * entries with family-specific fields (tables, collections, enums, …);
 * target concretions add target fields where the family vocabulary doesn't
 * reach.
 *
 * `storageHash` is a typed own property; namespace ids are own-enumerable
 * keys on the same object. Reserved-key skipping for walks lives in
 * {@link storageNamespaceEntries} / {@link isStoragePlaneReservedKey}.
 *
 * Extends `IRNode` so the framework's IR-walking surfaces (verifiers,
 * serializers) can dispatch on `Storage`-typed slots through the same
 * IR-node alphabet as every other node — the structural dual already
 * holds in code (every concrete storage class extends an IR-node base);
 * the interface promotion makes the typing honest.
 *
 * **Persisted envelope shape is target-owned, not framework-promised.**
 * Whether runtime-only fields on namespace concretions are stripped at
 * serialize time is a per-target decision made by
 * `ContractSerializer.serializeContract`. Some targets emit a JSON-clean
 * namespace shape that round-trips through `JSON.stringify` cleanly (SQL
 * today via the family-layer identity serializer); others ship
 * runtime-only fields on their namespace concretions and override
 * `serializeContract` to strip them (Mongo).
 */
export interface Storage extends IRNode {
  readonly storageHash: StorageHashBase<string>;
}
