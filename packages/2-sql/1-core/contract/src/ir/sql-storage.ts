import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  type Namespace,
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
 * Polymorphic value type for `SqlStorage.types` entries. The slot's
 * framework alphabet is `StorageType` — codec triples
 * (`StorageTypeInstance` with `kind: 'codec-instance'`) and
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

/**
 * Canonical (FR15) tables input shape:
 * `{ [namespaceId]: { [tableName]: StorageTable | StorageTableInput } }`.
 *
 * The only shape the constructor accepts. Same-named tables in distinct
 * namespaces (`auth.User` + `public.User`) coexist without collision.
 * Single-namespace contracts persist under
 * `{ [UNBOUND_NAMESPACE_ID]: { ... } }` or whatever single coordinate
 * they bind to.
 *
 * Every inner `StorageTableInput` carries a required `namespaceId`
 * back-pointer; the constructor checks that the outer key agrees with
 * each entry's `namespaceId` so the bucket boundary is unambiguous.
 */
export type SqlStorageTablesInput = Record<
  string,
  Record<string, StorageTable | StorageTableInput>
>;

/**
 * Canonical (FR15) types input shape:
 * `{ [namespaceId]: { [typeName]: SqlStorageTypeEntry } }`.
 *
 * The only shape the constructor accepts. Single-namespace contracts
 * persist under `{ [UNBOUND_NAMESPACE_ID]: { ... } }`.
 */
export type SqlStorageTypesInput = Record<string, Record<string, SqlStorageTypeEntry>>;

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  /**
   * Tables map in the FR15 nested-by-namespace shape:
   * `{ [namespaceId]: { [tableName]: ... } }`. Non-canonical inputs
   * (flat `{ [tableName]: ... }`, tables missing `namespaceId`, or
   * tables whose `namespaceId` disagrees with the enclosing namespace
   * key) are rejected at construction time.
   */
  readonly tables: SqlStorageTablesInput;
  /**
   * Types map in the FR15 nested-by-namespace shape. Same canonical
   * shape as `tables`.
   */
  readonly types?: SqlStorageTypesInput;
  readonly namespaces?: Readonly<Record<string, Namespace>>;
}

/**
 * SQL Contract IR root node for the `storage` field.
 *
 * Single concrete family-shared class — both Postgres and SQLite
 * consume this same class today.
 *
 * Honours the framework `Storage` interface: every SQL IR carries a
 * `namespaces` map keyed by namespace id.
 *
 * **Tables shape.** `tables` is the canonical nested-by-namespace map:
 * `{ [namespaceId]: { [tableName]: StorageTable } }`. Same-named
 * tables across namespaces (e.g. `auth.User` + `public.User`) coexist
 * without collision. Single-namespace contracts persist under
 * `{ [UNBOUND_NAMESPACE_ID]: { ... } }`.
 *
 * The constructor accepts only the nested-by-namespace input shape.
 * Non-canonical inputs (flat `{ [tableName]: ... }`, tables missing
 * `namespaceId`, or tables whose `namespaceId` disagrees with the
 * enclosing namespace key) are rejected loudly.
 *
 * `StorageTable.namespaceId` is retained as a back-pointer for
 * ergonomic walks; the constructor checks it agrees with the
 * enclosing nested key.
 *
 * Use {@link iterateAllTables} / {@link iterateTablesWithCoords} for
 * "walk every table" consumers, {@link findTableByCoord} for
 * `(namespaceId, name)` lookups, and {@link findTableByName} as the
 * legacy name-only lookup (throws when the name is ambiguous across
 * namespaces).
 *
 * The `types` slot follows the same nested-by-namespace shape.
 */
export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Readonly<Record<string, Readonly<Record<string, StorageTable>>>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;
  declare readonly types?: Readonly<
    Record<string, Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>>
  >;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.tables = freezeNestedTables(normaliseTablesInput(input.tables));
    this.namespaces = input.namespaces ?? DEFAULT_NAMESPACES;
    if (input.types !== undefined) {
      Object.defineProperty(this, 'types', {
        value: freezeNestedTypes(normaliseTypesInput(input.types)),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    freezeNode(this);
  }
}

/**
 * JSON envelope projection. Emits the nested-by-namespace shape
 * directly — `tables` and `types` are already in that form.
 *
 * Installed via `Object.defineProperty` (non-enumerable) on the
 * prototype so the user-facing `BuiltStorage<Definition>` type —
 * which `defineContract` builds bottom-up and which lacks a `toJSON`
 * method — remains structurally assignable to `SqlStorage`.
 */
Object.defineProperty(SqlStorage.prototype, 'toJSON', {
  value: function toJSON(this: SqlStorage): unknown {
    const envelope: Record<string, unknown> = {
      storageHash: this.storageHash,
      tables: this.tables,
      namespaces: this.namespaces,
    };
    if (this.types !== undefined) {
      envelope['types'] = this.types;
    }
    return envelope;
  },
  enumerable: false,
  writable: false,
  configurable: false,
});

/**
 * Walk the canonical FR15 nested input shape and normalise raw
 * `StorageTableInput` values into `StorageTable` class instances.
 *
 * The constructor accepts only the canonical nested-by-namespace
 * shape; non-canonical inputs (flat `{ [tableName]: ... }`, tables
 * missing `namespaceId`, or tables whose `namespaceId` disagrees
 * with the enclosing namespace key) are rejected here so every
 * downstream consumer can rely on a single shape.
 */
function normaliseTablesInput(
  input: SqlStorageTablesInput,
): Record<string, Record<string, StorageTable>> {
  const result: Record<string, Record<string, StorageTable>> = {};
  for (const [namespaceId, bucketInput] of Object.entries(input)) {
    rejectIfFlatTableEntry(namespaceId, bucketInput);
    const bucket: Record<string, StorageTable> = {};
    for (const [name, entry] of Object.entries(bucketInput)) {
      const table = entry instanceof StorageTable ? entry : new StorageTable(entry);
      if (table.namespaceId !== namespaceId) {
        throw new Error(
          `SqlStorage: table "${name}" carries namespaceId "${table.namespaceId}" but is keyed under namespace "${namespaceId}". The nested map key must agree with the back-pointer.`,
        );
      }
      bucket[name] = table;
    }
    result[namespaceId] = bucket;
  }
  return result;
}

/**
 * A nested bucket whose value is a `StorageTable`-shaped object (carries
 * `namespaceId` / `columns`) is the canonical sign that the caller
 * confused flat with nested input — the outer key was interpreted as
 * a namespace id and the value should have been a `{[tableName]: ...}`
 * bucket. Reject with a diagnostic that names the canonical shape.
 */
function rejectIfFlatTableEntry(namespaceId: string, bucketInput: unknown): void {
  if (bucketInput instanceof StorageTable) {
    throw new Error(
      `SqlStorage: tables["${namespaceId}"] is a StorageTable instance; expected a namespace bucket \`Record<tableName, StorageTable>\`. Wrap the table under \`tables: { '${namespaceId}': { '${namespaceId}': table } }\` or correct the namespace key.`,
    );
  }
  if (typeof bucketInput !== 'object' || bucketInput === null) {
    throw new Error(
      `SqlStorage: tables["${namespaceId}"] must be a \`Record<tableName, StorageTable>\` namespace bucket; received ${bucketInput === null ? 'null' : typeof bucketInput}.`,
    );
  }
  const tableShaped = bucketInput as { namespaceId?: unknown; columns?: unknown };
  if (typeof tableShaped.namespaceId === 'string' || tableShaped.columns !== undefined) {
    throw new Error(
      `SqlStorage: tables["${namespaceId}"] looks like a flat \`StorageTableInput\` (carries \`namespaceId\` or \`columns\`) rather than the canonical nested \`Record<namespaceId, Record<tableName, StorageTable>>\` shape. Rewrite the input as \`tables: { '<namespaceId>': { '<tableName>': { namespaceId: '<namespaceId>', ... } } }\`.`,
    );
  }
}

function freezeNestedTables(
  nested: Record<string, Record<string, StorageTable>>,
): Readonly<Record<string, Readonly<Record<string, StorageTable>>>> {
  const out: Record<string, Readonly<Record<string, StorageTable>>> = {};
  for (const [namespaceId, bucket] of Object.entries(nested)) {
    out[namespaceId] = Object.freeze({ ...bucket });
  }
  return Object.freeze(out);
}

function normaliseTypesInput(
  input: SqlStorageTypesInput,
): Record<string, Record<string, StorageTypeInstance | PostgresEnumStorageEntry>> {
  const out: Record<string, Record<string, StorageTypeInstance | PostgresEnumStorageEntry>> = {};
  for (const [namespaceId, bucketInput] of Object.entries(input)) {
    rejectIfFlatTypeEntry(namespaceId, bucketInput);
    const bucket: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {};
    for (const [name, entry] of Object.entries(bucketInput)) {
      bucket[name] = normaliseTypeEntry(entry);
    }
    out[namespaceId] = bucket;
  }
  return out;
}

/**
 * Symmetric guard for the types slot: a nested bucket whose value is a
 * `kind`-discriminated entry (or a codec-typed input shape with `codecId`)
 * is the canonical sign of flat-input confusion. Reject with a diagnostic
 * that names the canonical shape.
 */
function rejectIfFlatTypeEntry(namespaceId: string, bucketInput: unknown): void {
  if (bucketInput instanceof SqlNode) {
    throw new Error(
      `SqlStorage: types["${namespaceId}"] is a class-instance entry; expected a namespace bucket \`Record<typeName, ...>\`.`,
    );
  }
  if (typeof bucketInput !== 'object' || bucketInput === null) {
    throw new Error(
      `SqlStorage: types["${namespaceId}"] must be a \`Record<typeName, ...>\` namespace bucket; received ${bucketInput === null ? 'null' : typeof bucketInput}.`,
    );
  }
  const v = bucketInput as Record<string, unknown>;
  if (typeof v['kind'] === 'string' || typeof v['codecId'] === 'string') {
    throw new Error(
      `SqlStorage: types["${namespaceId}"] looks like a flat type entry (carries \`kind\` or \`codecId\`) rather than the canonical nested \`Record<namespaceId, Record<typeName, ...>>\` shape. Rewrite the input as \`types: { '<namespaceId>': { '<typeName>': { ... } } }\`.`,
    );
  }
}

function freezeNestedTypes(
  nested: Record<string, Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
): Readonly<
  Record<string, Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>>
> {
  const out: Record<
    string,
    Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>
  > = {};
  for (const [namespaceId, bucket] of Object.entries(nested)) {
    out[namespaceId] = Object.freeze({ ...bucket });
  }
  return Object.freeze(out);
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
      'Encountered raw postgres-enum JSON in storage.types without serializer hydration; use a target ContractSerializer that registers the matching entity-type factory.',
    );
  }
  if (isStorageTypeInstance(entry)) {
    return entry;
  }
  return toStorageTypeInstance(entry as StorageTypeInstanceInput);
}

/**
 * Iterate every table in the storage's nested map. Yields the
 * `(namespaceId, name, table)` coordinate tuple — the most general
 * shape consumers need; sites that only want the table itself can
 * destructure `{ table }`.
 */
export function* iterateTablesWithCoords(storage: Pick<SqlStorage, 'tables'>): IterableIterator<{
  readonly namespaceId: string;
  readonly name: string;
  readonly table: StorageTable;
}> {
  for (const [namespaceId, bucket] of Object.entries(storage.tables)) {
    for (const [name, table] of Object.entries(bucket)) {
      yield { namespaceId, name, table };
    }
  }
}

/**
 * Iterate every table in the storage, yielding only the `StorageTable`
 * instances. Use {@link iterateTablesWithCoords} when the namespace id
 * or table name is needed.
 */
export function* iterateAllTables(
  storage: Pick<SqlStorage, 'tables'>,
): IterableIterator<StorageTable> {
  for (const bucket of Object.values(storage.tables)) {
    for (const table of Object.values(bucket)) {
      yield table;
    }
  }
}

/**
 * Look up a table by name across every namespace bucket. Returns
 * `undefined` when no entry matches; throws when the same name appears
 * in more than one namespace (use {@link findTableByCoord} to
 * disambiguate).
 */
export function findTableByName(
  storage: Pick<SqlStorage, 'tables'>,
  name: string,
): StorageTable | undefined {
  let found: StorageTable | undefined;
  let foundIn: string | undefined;
  for (const [namespaceId, bucket] of Object.entries(storage.tables)) {
    if (Object.hasOwn(bucket, name)) {
      if (found !== undefined) {
        throw new Error(
          `findTableByName: table "${name}" exists in multiple namespaces ("${foundIn}" and "${namespaceId}"); use findTableByCoord(storage, namespaceId, name) to disambiguate.`,
        );
      }
      found = bucket[name];
      foundIn = namespaceId;
    }
  }
  return found;
}

/**
 * Look up a table by `(namespaceId, name)`. Returns `undefined` when
 * no matching entry exists.
 */
export function findTableByCoord(
  storage: Pick<SqlStorage, 'tables'>,
  namespaceId: string,
  name: string,
): StorageTable | undefined {
  return storage.tables[namespaceId]?.[name];
}

/**
 * Number of tables across every namespace.
 */
export function countAllTables(storage: Pick<SqlStorage, 'tables'>): number {
  let count = 0;
  for (const bucket of Object.values(storage.tables)) {
    count += Object.keys(bucket).length;
  }
  return count;
}

/**
 * Return every table-name in the storage, regardless of namespace.
 * Sites that need namespace-aware iteration should switch to
 * {@link iterateTablesWithCoords}.
 */
export function listAllTableNames(storage: Pick<SqlStorage, 'tables'>): string[] {
  const names: string[] = [];
  for (const bucket of Object.values(storage.tables)) {
    for (const name of Object.keys(bucket)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Iterate every type entry in the storage's nested map.
 */
export function* iterateTypesWithCoords(storage: Pick<SqlStorage, 'types'>): IterableIterator<{
  readonly namespaceId: string;
  readonly name: string;
  readonly entry: StorageTypeInstance | PostgresEnumStorageEntry;
}> {
  for (const [namespaceId, bucket] of Object.entries(storage.types ?? {})) {
    for (const [name, entry] of Object.entries(bucket)) {
      yield { namespaceId, name, entry };
    }
  }
}

/**
 * Look up a type entry by name across every namespace bucket. Throws
 * when the same name appears in more than one namespace.
 */
export function findTypeByName(
  storage: Pick<SqlStorage, 'types'>,
  name: string,
): StorageTypeInstance | PostgresEnumStorageEntry | undefined {
  let found: StorageTypeInstance | PostgresEnumStorageEntry | undefined;
  let foundIn: string | undefined;
  for (const [namespaceId, bucket] of Object.entries(storage.types ?? {})) {
    if (Object.hasOwn(bucket, name)) {
      if (found !== undefined) {
        throw new Error(
          `findTypeByName: type "${name}" exists in multiple namespaces ("${foundIn}" and "${namespaceId}"); narrow the lookup by namespace.`,
        );
      }
      found = bucket[name];
      foundIn = namespaceId;
    }
  }
  return found;
}

/**
 * Look up a type entry by `(namespaceId, name)`. Returns `undefined`
 * when no matching entry exists.
 */
export function findTypeByCoord(
  storage: Pick<SqlStorage, 'types'>,
  namespaceId: string,
  name: string,
): StorageTypeInstance | PostgresEnumStorageEntry | undefined {
  return storage.types?.[namespaceId]?.[name];
}
