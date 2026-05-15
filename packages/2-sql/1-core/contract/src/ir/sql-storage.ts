import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  type Namespace,
  type Storage,
  UNSPECIFIED_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { SqlEnumType } from './sql-enum-type';
import { SqlNode } from './sql-node';
import { SqlUnspecifiedNamespace } from './sql-unspecified-namespace';
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
 * triples (carrying `kind: 'codec-instance'`) and class-instance kinds
 * (e.g. `PostgresEnumType` with its narrower discriminator) both
 * satisfy that contract. {@link StorageTypeInstanceInput} is accepted on
 * the construction side so callers may pass raw codec triples and let
 * the constructor stamp the discriminator.
 */
export type SqlStorageTypeEntry = SqlEnumType | StorageTypeInstance | StorageTypeInstanceInput;

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
 * (e.g. `SqlEnumType` subclasses) pass through; hydration of raw JSON
 * class-instance entries (carrying their narrower `kind` literal) is
 * the per-target serializer's responsibility (so the family base does
 * not import target-specific subclasses).
 */
export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Readonly<Record<string, StorageTable>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;
  // The slot is structurally polymorphic at the framework level
  // (every variant extends `StorageType` from
  // `@prisma-next/framework-components/ir`); SQL declares the concrete
  // union it ships today. Future SQL-family variants (e.g. PR2's
  // namespace concretion if it joins the slot) widen this union.
  declare readonly types?: Readonly<Record<string, SqlEnumType | StorageTypeInstance>>;

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
          Object.entries(input.types).map(([name, ti]) => [name, normaliseTypeEntry(ti)]),
        ),
      );
    }
    freezeNode(this);
  }
}

function normaliseTypeEntry(entry: SqlStorageTypeEntry): SqlEnumType | StorageTypeInstance {
  if (entry instanceof SqlEnumType) {
    return entry;
  }
  if (isStorageTypeInstance(entry)) {
    return entry;
  }
  if (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as { kind?: unknown }).kind === 'sql-enum-type'
  ) {
    throw new Error(
      'Encountered raw sql-enum-type JSON in storage.types without serializer hydration; use a target ContractSerializer that registers the matching entity-type factory.',
    );
  }
  return toStorageTypeInstance(entry);
}
