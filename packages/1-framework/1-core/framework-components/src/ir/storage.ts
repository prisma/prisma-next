import type { IRNode } from './ir-node';
import type { Namespace } from './namespace';

export interface EntityCoordinate {
  readonly namespaceId: string;
  readonly entityKind: string;
  readonly entityName: string;
}

const SLOT_KEYS_BY_NAMESPACE_KIND = new Map<
  string,
  ReadonlyArray<{ readonly slotKey: string; readonly entityKind: string }>
>([
  [
    'sql-namespace',
    [
      { slotKey: 'tables', entityKind: 'tables' },
      { slotKey: 'types', entityKind: 'types' },
    ],
  ],
  ['mongo-namespace', [{ slotKey: 'collections', entityKind: 'collections' }]],
]);

/**
 * Lazy walk over every named storage entity in a `Storage`-shaped
 * value, yielded as `(namespaceId, entityKind, entityName)` triples.
 *
 * Dispatch is keyed on each namespace's `kind` literal. The slot-key
 * table below is hardcoded for the two namespace kinds shipping
 * today (`'sql-namespace'`, `'mongo-namespace'`); the
 * pack-contributed descriptor registry replaces this lookup once it
 * lands. Unrecognised `kind` values throw with a diagnostic naming
 * the namespace id and the offending kind — silent skipping would
 * hide drift from the future verifier consumer.
 */
export function* elementCoordinates(storage: Storage): Generator<EntityCoordinate> {
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    const slotKeys = SLOT_KEYS_BY_NAMESPACE_KIND.get(ns.kind);
    if (slotKeys === undefined) {
      throw new Error(
        `elementCoordinates(): unrecognised namespace kind ${JSON.stringify(ns.kind)} ` +
          `on namespace ${JSON.stringify(namespaceId)}. ` +
          'Add a slot-key entry to SLOT_KEYS_BY_NAMESPACE_KIND, ' +
          'or wait for the pack-contributed descriptor registry (D2).',
      );
    }
    for (const { slotKey, entityKind } of slotKeys) {
      const slot = (ns as unknown as Readonly<Record<string, unknown>>)[slotKey];
      if (slot !== undefined && slot !== null && typeof slot === 'object') {
        for (const entityName of Object.keys(slot)) {
          yield { namespaceId, entityKind, entityName };
        }
      }
    }
  }
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
