import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  type Storage,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type { PostgresEnumStorageEntry } from './postgres-enum-storage-entry';
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
 * Polymorphic value type for document-scoped `SqlStorage.types` entries
 * (codec aliases / parameterised native type registrations). Postgres
 * native enum registrations live under
 * `storage.namespaces[namespaceId].types` instead.
 */
export type SqlStorageTypeEntry = StorageTypeInstance | StorageTypeInstanceInput;

const DEFAULT_NAMESPACES: Readonly<Record<string, Namespace>> = Object.freeze({
  [UNBOUND_NAMESPACE_ID]: SqlUnboundNamespace.instance,
});

export interface SqlNamespaceTablesInput {
  readonly id: string;
  readonly tables?: Record<string, StorageTable | StorageTableInput>;
  readonly types?: Record<string, PostgresEnumStorageEntry>;
}

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
  readonly namespaces?: Readonly<Record<string, Namespace | SqlNamespaceTablesInput>>;
}

class SqlNamespacePayload extends NamespaceBase {
  declare readonly kind?: string;
  declare readonly types?: Readonly<Record<string, PostgresEnumStorageEntry>>;

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
    if (input.types !== undefined && Object.keys(input.types).length > 0) {
      Object.defineProperty(this, 'types', {
        value: Object.freeze({ ...input.types }),
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
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
  const input = ns as SqlNamespaceTablesInput; // JSON namespace payloads match SqlNamespaceTablesInput before SqlNamespacePayload materialises StorageTable instances.
  const tableCount = Object.keys(input.tables ?? {}).length;
  const typeCount = Object.keys(input.types ?? {}).length;
  if (nsKey === UNBOUND_NAMESPACE_ID && tableCount === 0 && typeCount === 0) {
    return SqlUnboundNamespace.instance;
  }
  return new SqlNamespacePayload(input);
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
// SQL concretions always store `StorageTable` instances in `tables`.
// Narrowing the namespace map here lets target/family-level consumers
// iterate `namespaces[*].tables[*]` and recover the concrete table type
// without the framework's wider `object` value forcing per-site casts.
export type SqlNamespace = Namespace & {
  readonly tables: Readonly<Record<string, StorageTable>>;
};

export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  // The `__unbound__` namespace is always present at runtime — every SQL
  // contract has a late-binding slot whose binding the target resolves at
  // connection time. Every namespace's `tables` slot is narrowed to
  // `StorageTable` (rather than the framework's wider `object`) so DSL
  // surfaces and runtime walkers can address it without an optional
  // narrowing dance at every call site.
  readonly namespaces: Readonly<Record<string, SqlNamespace>> & {
    readonly __unbound__: SqlNamespace;
  };
  declare readonly types?: Readonly<Record<string, StorageTypeInstance>>;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    const inputNamespaces = input.namespaces ?? DEFAULT_NAMESPACES;
    const normalised: Record<string, Namespace> = Object.fromEntries(
      Object.entries(inputNamespaces).map(([nsKey, ns]) => [
        nsKey,
        normaliseNamespaceEntry(nsKey, ns),
      ]),
    );
    if (!normalised[UNBOUND_NAMESPACE_ID]) {
      normalised[UNBOUND_NAMESPACE_ID] = SqlUnboundNamespace.instance;
    }
    this.namespaces = Object.freeze(normalised) as Readonly<Record<string, SqlNamespace>> & {
      readonly __unbound__: SqlNamespace;
    };
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

function normaliseTypeEntry(entry: SqlStorageTypeEntry): StorageTypeInstance {
  if (isStorageTypeInstance(entry)) {
    return entry;
  }
  return toStorageTypeInstance(entry as StorageTypeInstanceInput);
}
