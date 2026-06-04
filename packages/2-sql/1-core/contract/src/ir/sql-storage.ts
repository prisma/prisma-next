import type { StorageHashBase } from '@prisma-next/contract/types';
import { freezeNode, type Namespace, type Storage } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';
import type { StorageTable, StorageTableInput } from './storage-table';
import {
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
} from './storage-type-instance';

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
  readonly entries: {
    readonly table: Record<string, StorageTable | StorageTableInput>;
    /** Target-specific pass-through: postgres enum entries under `type`. */
    readonly type?: Record<string, unknown>;
  };
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
// SQL concretions store `StorageTable` values under `entries.table`.
// Mongo namespaces carry `entries.collection` instead. The wider
// `Record<string, object>` on `StorageTable` is only there so emitted
// `contract.d.ts` table literals (which lack the runtime `kind`
// discriminator on `StorageTable`) structurally satisfy the slot without
// a class-instance check.
export type SqlNamespace = Namespace & {
  readonly entries: Readonly<{
    readonly table: Readonly<Record<string, StorageTable>>;
    /** Target-specific pass-through: postgres enum entries under `type`. */
    readonly type?: Readonly<Record<string, unknown>>;
  }>;
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
  return storage.namespaces[namespaceId]?.entries.table?.[tableName];
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
    return entry;
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
