import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  type Storage,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
} from './postgres-enum-storage-entry';
import { SqlNode } from './sql-node';
import { SqlUnboundNamespace } from './sql-unbound-namespace';
import { StorageTable, type StorageTableInput } from './storage-table';
import {
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
  toStorageTypeInstance,
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
  [UNBOUND_NAMESPACE_ID]: SqlUnboundNamespace.instance,
});

export interface SqlNamespaceTablesInput {
  readonly id: string;
  readonly tables?: Record<string, StorageTable | StorageTableInput>;
}

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
  readonly namespaces?: Readonly<Record<string, Namespace | SqlNamespaceTablesInput>>;
}

class SqlNamespacePayload extends NamespaceBase {
  declare readonly kind?: string;

  readonly id: string;
  readonly tables: Readonly<Record<string, StorageTable>>;

  constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables ?? {}).map(([name, t]) => [
          name,
          t instanceof StorageTable ? t : new StorageTable(t),
        ]),
      ),
    );
    Object.defineProperty(this, 'kind', {
      value: 'sql-namespace',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }
}

function normaliseNamespaceEntry(
  nsKey: string,
  ns: Namespace | SqlNamespaceTablesInput,
): Namespace {
  if (ns instanceof NamespaceBase) {
    return ns;
  }
  const tableCount = Object.keys(ns.tables ?? {}).length;
  if (nsKey === UNBOUND_NAMESPACE_ID && tableCount === 0) {
    return SqlUnboundNamespace.instance;
  }
  return new SqlNamespacePayload(ns as SqlNamespaceTablesInput);
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
 * `namespaces` map keyed by namespace id. The default singleton
 * (`{ [UNBOUND_NAMESPACE_ID]: SqlUnboundNamespace.instance }`)
 * binds every contract authored before per-target namespace concretions
 * land; per-target namespace classes (`PostgresSchema.unbound`,
 * `SqliteUnboundDatabase.instance`) earn their slots when each
 * target's namespace shape lands.
 *
 * The constructor normalises optional `types` into class instances and
 * materialises plain namespace envelope objects into `Namespace` class
 * instances so downstream walks see a uniform AST.
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
    this.namespaces = Object.freeze(
      Object.fromEntries(
        Object.entries(input.namespaces ?? DEFAULT_NAMESPACES).map(([nsKey, ns]) => [
          nsKey,
          normaliseNamespaceEntry(nsKey, ns),
        ]),
      ),
    );
    if (input.types !== undefined) {
      this.types = Object.freeze(
        Object.fromEntries(
          Object.entries(input.types).map(([name, ti]) => [name, normaliseTypeEntry(ti)]),
        ),
      );
    }
    freezeNode(this);
  }
}

function normaliseTypeEntry(
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
      'Encountered raw postgres-enum JSON in document-scoped storage.types; postgres enums belong under storage.namespaces[namespaceId].types and require PostgresContractSerializer.',
    );
  }
  if (isStorageTypeInstance(entry)) {
    return entry;
  }
  return toStorageTypeInstance(entry as StorageTypeInstanceInput);
}
