import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  type Namespace,
  type Storage,
  UNSPECIFIED_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
} from './postgres-enum-storage-entry';
import { SqlNode } from './sql-node';
import { SqlUnspecifiedNamespace } from './sql-unspecified-namespace';
import { StorageTable, type StorageTableInput } from './storage-table';
import {
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
} from './storage-type-instance';

/**
 * Polymorphic value type for `SqlStorage.types` entries (Decision 18,
 * Option B). The slot's framework alphabet is `StorageType` — codec
 * triples (`StorageTypeInstance` with `kind: 'codec-instance'`) and
 * target-specific IR class instances structurally satisfying
 * `PostgresEnumStorageEntry` (with `kind: 'postgres-enum'`) are the
 * two variants the SQL family ships today. The construction side also
 * accepts {@link StorageTypeInstanceInput} so callers can pass raw
 * codec triples; the constructor stamps the discriminator.
 */
export type SqlStorageTypeEntry =
  | StorageTypeInstance
  | PostgresEnumStorageEntry
  | StorageTypeInstanceInput;

const DEFAULT_NAMESPACES: Readonly<Record<string, Namespace>> = Object.freeze({
  [UNSPECIFIED_NAMESPACE_ID]: SqlUnspecifiedNamespace.instance,
});

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Record<string, StorageTable | StorageTableInput>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
  readonly namespaces?: Readonly<Record<string, Namespace>>;
}

/**
 * SQL Contract IR root node for the `storage` field.
 *
 * Single concrete family-shared class — both Postgres and SQLite
 * consume this same class today. Per-target storage subclasses are
 * introduced when each target's namespace shape earns its
 * target-specific concretion (target-specific derived fields,
 * target-specific storage extensions).
 *
 * Honours the framework `Storage` interface: every SQL IR carries a
 * `namespaces` map keyed by namespace id. The default singleton
 * (`{ [UNSPECIFIED_NAMESPACE_ID]: SqlUnspecifiedNamespace.instance }`)
 * binds every contract authored before per-target namespace concretions
 * land; per-target namespace classes (`PostgresSchema.unspecified`,
 * `SqliteUnspecifiedDatabase.instance`) earn their slots when each
 * target's namespace shape lands.
 *
 * The constructor normalises nested IR-class fields (`tables`, optional
 * `types`) into class instances so downstream walks see a uniform AST.
 * `types` is polymorphic per Decision 18 Option B: codec-triple inputs
 * are stamped with `kind: 'codec-instance'`; class-instance kinds
 * (e.g. Postgres-enum entries satisfying `PostgresEnumStorageEntry`)
 * pass through; hydration of raw JSON class-instance entries (carrying
 * their narrower `kind` literal) is the per-target serializer's
 * responsibility (so the family base does not import target-specific
 * subclasses).
 */
export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Readonly<Record<string, StorageTable>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;
  // SQL-family slot view: the two structural variants the family ships
  // today (codec triples + Postgres-enum structural entries). Each
  // variant extends the framework `StorageType` alphabet; the SQL
  // narrowing keeps cross-domain layering clean — SQL-family consumers
  // dispatch via `isStorageTypeInstance` / `isPostgresEnumStorageEntry`
  // type guards rather than importing the target's concrete IR class
  // (cross-domain rule: SQL may not import `target-*`).
  declare readonly types?: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([name, t]) => [
          name,
          t instanceof StorageTable ? t : new StorageTable(t),
        ]),
      ),
    );
    this.namespaces = input.namespaces ?? DEFAULT_NAMESPACES;
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

/**
 * Strict polymorphic-slot dispatch for `SqlStorage.types` entries
 * (TML-2536). Every entry must carry a recognised `kind` discriminator
 * — either `'codec-instance'` (codec triple, family-shared) or
 * `'postgres-enum'` (target-specific IR class). Untagged or
 * unrecognised inputs throw a diagnostic naming the entry and its
 * `kind`, so format drift surfaces loudly at the deserializer
 * boundary instead of slipping past the seam and corrupting
 * downstream IR walks.
 *
 * Codec-triple authors that have an untagged shape on hand can call
 * `toStorageTypeInstance(...)` (which stamps the `'codec-instance'`
 * discriminator) before constructing `SqlStorage`. On-disk reads
 * cross `familyInstance.validateContract` first; the structural
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
