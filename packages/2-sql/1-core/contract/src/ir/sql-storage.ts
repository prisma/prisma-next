import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  flatStorageInput,
  freezeNode,
  isStoragePlaneReservedKey,
  type Namespace,
  type Storage,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import {
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
} from './postgres-enum-storage-entry';
import { SqlNode } from './sql-node';
import type { StorageTable, StorageTableInput } from './storage-table';
import {
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
} from './storage-type-instance';

/**
 * Polymorphic value type for document-scoped `SqlStorage.types` entries
 * (codec aliases / parameterised native type registrations). Postgres
 * native enum registrations live under
 * `storage.<namespaceId>.enum` instead.
 */
export type SqlStorageTypeEntry =
  | StorageTypeInstance
  | StorageTypeInstanceInput
  | PostgresEnumStorageEntry;

export interface SqlNamespaceTablesInput {
  readonly id: string;
  readonly tables?: Record<string, StorageTable | StorageTableInput>;
  readonly enum?: Record<string, PostgresEnumStorageEntry>;
}

export type SqlStorageInput<THash extends string = string> = {
  readonly storageHash: StorageHashBase<THash>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
} & Readonly<Record<string, SqlNamespace>> & {
    readonly __unbound__: SqlNamespace;
  };

export type SqlStorageNamespacesInput<THash extends string = string> = {
  readonly storageHash: StorageHashBase<THash>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
  readonly namespaces: Readonly<Record<string, SqlNamespace>> & {
    readonly __unbound__: SqlNamespace;
  };
};

export function buildSqlStorageInput<THash extends string>(
  input: SqlStorageNamespacesInput<THash>,
): SqlStorageInput<THash> {
  // `flatStorageInput` widens the namespace spread to
  // `Record<string, SqlNamespace>`; TS cannot re-derive the
  // `__unbound__`-branded `SqlStorageInput` from a spread, but the
  // `SqlStorageNamespacesInput` parameter already guarantees that brand.
  return blindCast<
    SqlStorageInput<THash>,
    'flat spread cannot reconstruct the __unbound__-branded SqlStorageInput; the namespaces-keyed input guarantees the brand'
  >(
    flatStorageInput({
      storageHash: input.storageHash,
      ...(input.types !== undefined ? { types: input.types } : {}),
      namespaces: input.namespaces,
    }),
  );
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
 * Honours the framework `Storage` interface: namespace ids are direct
 * keys on the storage object alongside the reserved `storageHash` (and
 * optional document-scoped `types`). Callers must supply fully
 * constructed `Namespace` instances — construction discipline lives
 * in the authoring builders and deserializer hydration paths.
 *
 * The constructor normalises optional `types` into class instances.
 * `types` is polymorphic per Decision 18 Option B: codec-triple inputs
 * are stamped with `kind: 'codec-instance'`; class-instance kinds
 * (e.g. Postgres-enum entries satisfying `PostgresEnumStorageEntry`)
 * pass through; hydration of raw JSON class-instance entries (carrying
 * their narrower `kind` literal) is the per-target serializer's
 * responsibility (so the family base does not import target-specific
 * subclasses).
 */
// SQL concretions always store `StorageTable`-shaped values in `tables`.
// `tables` is a SQL-family idiom — the framework `Namespace` contract no
// longer mandates this field; Mongo namespaces carry `collections`
// instead. The `__unbound__` slot uses the same narrowing as every other
// SQL namespace; the wider `Record<string, object>` on `StorageTable` is
// only there so emitted `contract.d.ts` table literals (which lack the
// runtime `kind` discriminator on `StorageTable`) structurally satisfy
// the slot without a class-instance check.
export type SqlNamespace = Namespace & {
  readonly tables: Readonly<Record<string, StorageTable>>;
  readonly enum?: Readonly<Record<string, PostgresEnumStorageEntry>>;
};

export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  declare readonly __unbound__: SqlNamespace;
  declare readonly types?: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    if (input.types !== undefined) {
      this.types = Object.freeze(
        Object.fromEntries(
          Object.entries(input.types).map(([name, ti]) => [name, normaliseTypeEntry(name, ti)]),
        ),
      );
    }
    for (const [key, value] of Object.entries(input)) {
      if (isStoragePlaneReservedKey(key)) continue;
      Object.defineProperty(this, key, {
        value: Object.freeze(value),
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
    freezeNode(this);
  }
}

/**
 * Strict polymorphic-slot dispatch for `SqlStorage.types` entries.
 * Every entry must carry a recognised `kind` discriminator — either
 * `'codec-instance'` (codec triple, family-shared) or
 * `'postgres-enum'` (target-specific IR class). Untagged or
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
function normaliseTypeEntry(
  name: string,
  entry: SqlStorageTypeEntry,
): StorageTypeInstance | PostgresEnumStorageEntry {
  if (isPostgresEnumStorageEntry(entry)) {
    // Live class instances pass through unchanged; raw JSON envelopes
    // (e.g. `kind: 'postgres-enum'` without the class identity) are
    // rejected so the target serializer's hydration path is the only
    // way IR class instances enter the slot.
    if (entry instanceof SqlNode) {
      return entry;
    }
    throw new Error(
      `Encountered raw postgres-enum JSON in storage.types[${JSON.stringify(name)}] without serializer hydration; use a target ContractSerializer that registers the matching entity-type factory.`,
    );
  }
  if (isStorageTypeInstance(entry)) {
    return entry;
  }
  const rawKind = (entry as { kind?: unknown }).kind;
  const kindDescription =
    rawKind === undefined
      ? 'missing `kind` discriminator'
      : `unrecognised \`kind\` discriminator ${JSON.stringify(rawKind)}`;
  throw new Error(
    `storage.types[${JSON.stringify(name)}] has ${kindDescription}; expected ${JSON.stringify('codec-instance')} or ${JSON.stringify('postgres-enum')}. Untagged codec triples should be wrapped with toStorageTypeInstance(...) before construction.`,
  );
}
