import type { StorageHashBase } from '@prisma-next/contract/types';
import { freezeNode, type Namespace, type Storage } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';
import type { StorageTable } from './storage-table';
import {
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
  toStorageTypeInstance,
} from './storage-type-instance';
import type { StorageValueSet } from './storage-value-set';

/**
 * Polymorphic value type for document-scoped `SqlStorage.types` entries
 * (codec aliases / parameterised native type registrations).
 *
 * Postgres native enum registrations live under the postgres-specific
 * `entries.type` slot on `PostgresSchema` (target layer), not here.
 */
export type SqlStorageTypeEntry = StorageTypeInstance | StorageTypeInstanceInput;

export interface SqlNamespaceTablesInput {
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
  readonly namespaces: Readonly<Record<string, SqlNamespace>>;
}

/**
 * SQL Contract IR root node for the `storage` field.
 *
 * Single concrete family-shared class — both Postgres and SQLite
 * consume this class today. Per-target storage subclasses are
 * introduced when each target's namespace shape earns its
 * target-specific concretion (target-specific derived fields,
 * target-specific storage extensions).
 *
 * Honours the framework `Storage` interface: every SQL IR carries a
 * `namespaces` map keyed by namespace id. Callers must supply fully
 * constructed `Namespace` instances — construction discipline lives
 * in the authoring builders and deserializer hydration paths.
 *
 * The constructor normalises optional `types` into class instances.
 * `types` is polymorphic per Decision 18 Option B: codec-triple inputs
 * are stamped with `kind: 'codec-instance'`; hydration of raw JSON
 * class-instance entries (carrying their narrower `kind` literal) is
 * the per-target serializer's responsibility (so the family base does
 * not import target-specific subclasses).
 */
/**
 * The typed `entries` shape for SQL family namespaces. The open dictionary
 * is intersected with optional known-kind maps so that `ns.entries.table`
 * and `ns.entries.valueSet` resolve without a cast, while unknown pack-
 * contributed kinds remain valid (the `Record` part allows any string key).
 */
export type SqlNamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
  readonly table?: Readonly<Record<string, StorageTable>>;
  readonly valueSet?: Readonly<Record<string, StorageValueSet>>;
};

/**
 * SQL family namespace. `entries` is the open ADR 224 dictionary —
 * `entries[entityKind][entityName]` addresses any entity. Emitted
 * contract literals satisfy this structurally (no prototype getters
 * needed). For typed access to specific kinds, use the class getters
 * on the concretion or `ns.entries.table` / `ns.entries.valueSet` directly.
 */
export type SqlNamespace = Namespace & {
  readonly entries: SqlNamespaceEntries;
  /**
   * Render a dialect-qualified table reference for runtime SQL emission.
   * Present on materialised target concretions (`PostgresSchema`,
   * `SqliteDatabase`, …) and family placeholders; omitted on emitted
   * contract structural namespace literals (methods are not serialised).
   */
  qualifyTable?(tableName: string): string;
};

export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, SqlNamespace>>;
  declare readonly types?: Readonly<Record<string, StorageTypeInstance>>;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.namespaces = Object.freeze(input.namespaces);
    if (input.types !== undefined) {
      this.types = Object.freeze(
        Object.fromEntries(
          Object.entries(input.types).map(([name, ti]) => [name, normaliseTypeEntry(name, ti)]),
        ),
      );
    }
    freezeNode(this);
  }
}

export function storageTableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const ns = storage.namespaces[namespaceId];
  if (ns === undefined) return undefined;
  return ns.entries.table?.[tableName];
}

/**
 * Strict polymorphic-slot dispatch for `SqlStorage.types` entries.
 * Every entry must carry a `kind: 'codec-instance'` discriminator or
 * be an already-constructed `StorageTypeInstance`. Untagged or
 * unrecognised inputs throw a diagnostic naming the entry and its
 * `kind`, so format drift surfaces loudly at the deserializer
 * boundary instead of slipping past the seam and corrupting
 * downstream IR walks.
 *
 * Codec-triple authors that have an untagged shape on hand can call
 * `toStorageTypeInstance(...)` (which stamps the `'codec-instance'`
 * discriminator) before constructing `SqlStorage`. On-disk reads
 * cross `familyInstance.deserializeContract` first; the structural
 * arktype schema rejects untagged entries earlier, so this throw
 * only fires for in-memory authoring bugs.
 */
function normaliseTypeEntry(name: string, entry: SqlStorageTypeEntry): StorageTypeInstance {
  if (isStorageTypeInstance(entry)) {
    // Normalise on-disk objects that omit `typeParams` (the canonical on-disk
    // form strips empty typeParams to keep JSON compact). The in-memory invariant
    // is always `typeParams: {}` when empty — never `undefined`. Only create a
    // new object when necessary to preserve identity-equality for callers that
    // hold a reference to an already-correct in-memory entry.
    if ('typeParams' in entry) {
      return entry;
    }
    return toStorageTypeInstance(entry);
  }
  const rawKind = (entry as { kind?: unknown }).kind;
  const kindDescription =
    rawKind === undefined
      ? 'missing `kind` discriminator'
      : `unrecognised \`kind\` discriminator ${JSON.stringify(rawKind)}`;
  throw new Error(
    `storage.types[${JSON.stringify(name)}] has ${kindDescription}; expected ${JSON.stringify('codec-instance')}. Untagged codec triples should be wrapped with toStorageTypeInstance(...) before construction.`,
  );
}
