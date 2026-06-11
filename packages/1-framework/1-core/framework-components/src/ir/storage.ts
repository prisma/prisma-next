import type { StorageBase } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { IRNode } from './ir-node';
import type { Namespace } from './namespace';

/**
 * Canonical address for a named entity in Contract IR / Schema IR.
 *
 * `plane` is `'domain' | 'storage'`: which top-level contract plane the
 * entity lives on. Domain-side walks yield `plane: 'domain'` via
 * {@link domainElementCoordinates}; {@link elementCoordinates} over storage
 * yields `plane: 'storage'`.
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
 * Iterates each namespace's `entries` slot maps structurally. Skips
 * non-object `entries`; `id` and `kind` are not walked (`kind` is
 * non-enumerable on concretions). For every entity-kind key under
 * `entries` whose value is a non-null object, yields one coordinate per
 * entity name in that map. No family-specific slot vocabulary is required.
 */
export function* elementCoordinates(
  storage: Pick<StorageBase, 'namespaces'>,
): Generator<EntityCoordinate> {
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    const entries = ns.entries;
    if (entries === null || typeof entries !== 'object') continue;
    for (const [entityKind, slot] of Object.entries(entries)) {
      if (slot === null || typeof slot !== 'object') continue;
      for (const entityName of Object.keys(slot)) {
        yield { plane: 'storage', namespaceId, entityKind, entityName };
      }
    }
  }
}

/**
 * Looks up a single entity in a `Storage`-shaped value by its full coordinate.
 * Returns `undefined` if the namespace, entity kind, or entity name is absent.
 * Generic/walker code that needs a typed result should cast after calling this.
 */
export function entityAt(
  storage: Pick<StorageBase, 'namespaces'>,
  coord: Pick<EntityCoordinate, 'namespaceId' | 'entityKind' | 'entityName'>,
): unknown {
  const ns = storage.namespaces[coord.namespaceId];
  if (ns === undefined) return undefined;
  const entries = ns.entries;
  if (entries === null || typeof entries !== 'object') return undefined;
  const kindMap = blindCast<Record<string, unknown>, 'checked object, non-null above'>(entries)[
    coord.entityKind
  ];
  if (kindMap === null || typeof kindMap !== 'object') return undefined;
  return blindCast<Record<string, unknown>, 'checked object, non-null above'>(kindMap)[
    coord.entityName
  ];
}

/**
 * Framework-level promise that every Contract IR / Schema IR carries a
 * collection of namespaces keyed by namespace id. Family storage
 * concretions (`SqlStorage`, `MongoStorage`) refine the shape with
 * family-specific fields (tables, collections, enums, …); target
 * concretions add target fields where the family vocabulary doesn't
 * reach.
 *
 * Keeping `namespaces` at the framework layer enforces that every storage
 * object — across any target — is namespace-scoped. The framework can
 * therefore walk the namespace map without knowing the family alphabet, and
 * the `(namespace.id, name)` keying that the verifier and planner depend on
 * is honest at every layer.
 *
 * Extends `IRNode` so the framework's IR-walking surfaces (verifiers,
 * serializers) can dispatch on `Storage`-typed slots through the same
 * IR-node alphabet as every other node — the structural dual already
 * holds in code (every concrete storage class extends an IR-node base);
 * the interface promotion makes the typing honest.
 *
 * **Persisted envelope shape is target-owned, not framework-promised.**
 * Whether the `namespaces` map appears in the on-disk JSON envelope is
 * a per-target decision made by `ContractSerializer.serializeContract`.
 * Some targets emit a JSON-clean namespace shape that round-trips
 * through `JSON.stringify` cleanly (SQL today via the family-layer
 * identity serializer); others ship runtime-only fields on their
 * namespace concretions and override `serializeContract` to strip
 * them (Mongo). Future open (F16): extend the per-target
 * `ContractSerializer` integration-test surface with an explicit
 * envelope-shape assertion for each target, so the strip-vs-pass-through
 * choice is locked at test time rather than implied by the override
 * presence/absence. Earned by PR2's per-target namespace lift, when
 * `PostgresSchema` / `SqliteUnboundDatabase` start carrying
 * target-specific fields.
 */
export interface Storage extends IRNode {
  readonly namespaces: Readonly<Record<string, Namespace>>;
}
