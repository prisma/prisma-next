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
 * Flat (legacy) tables input shape: `{ [tableName]: StorageTable | StorageTableInput }`.
 * Each entry's `namespaceId` (defaulted to {@link UNBOUND_NAMESPACE_ID})
 * decides which nested namespace bucket the entry lifts into. Same-named
 * tables in different namespaces cannot be expressed via this shape; the
 * second occurrence collides on the `tableName` key — use the nested
 * input shape ({@link SqlStorageTablesNestedInput}) when authoring
 * cross-namespace same-named tables.
 *
 * Accepted as ergonomic sugar at the constructor boundary so existing
 * single-namespace authoring stays terse.
 */
export type SqlStorageTablesFlatInput = Record<string, StorageTable | StorageTableInput>;

/**
 * Nested (FR15) tables input shape:
 * `{ [namespaceId]: { [tableName]: StorageTable | StorageTableInput } }`.
 * The only shape that can express two same-named tables in distinct
 * namespaces (`auth.User` + `public.User`) without collision.
 */
export type SqlStorageTablesNestedInput = Record<
  string,
  Record<string, StorageTable | StorageTableInput>
>;

export type SqlStorageTypesFlatInput = Record<string, SqlStorageTypeEntry>;

export type SqlStorageTypesNestedInput = Record<string, Record<string, SqlStorageTypeEntry>>;

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  /**
   * Tables map. Accepts the legacy flat shape (`{ [tableName]: ... }`)
   * or the FR15 nested-by-namespace shape (`{ [namespaceId]: { [tableName]: ... } }`).
   * Flat input is bucketed by each entry's `StorageTable.namespaceId`
   * field (default {@link UNBOUND_NAMESPACE_ID}).
   */
  readonly tables: SqlStorageTablesFlatInput | SqlStorageTablesNestedInput;
  /**
   * Types map. Same dual-shape contract as `tables`. Flat input
   * buckets under {@link UNBOUND_NAMESPACE_ID}.
   */
  readonly types?: SqlStorageTypesFlatInput | SqlStorageTypesNestedInput;
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
 * **Tables shape (FR15 dual view).** The IR exposes two views of the
 * same data, both populated at construction:
 *
 * - `tables: Readonly<Record<TableName, StorageTable>>` — the
 *   ergonomic flat-by-name view. Single-namespace contracts use this
 *   exclusively. Same-named tables across namespaces resolve to the
 *   first entry encountered (iteration order of the nested map);
 *   consumers needing the collision-free truth must read
 *   `tablesByNamespace`.
 * - `tablesByNamespace: Readonly<Record<NamespaceId, Record<TableName,
 *   StorageTable>>>` — the FR15 nested-by-namespace truth. Same-named
 *   tables across namespaces (e.g. `auth.User` + `public.User`)
 *   coexist here without collision.
 *
 * The constructor accepts either flat input (legacy authoring;
 * bucketed by each entry's `StorageTable.namespaceId`, default
 * {@link UNBOUND_NAMESPACE_ID}) or the FR15 nested shape directly.
 *
 * `StorageTable.namespaceId` is retained as a back-pointer for
 * ergonomic walks; the constructor validates it agrees with the
 * enclosing nested key when nested input is supplied.
 *
 * Use {@link iterateAllTables} / {@link iterateTablesWithCoords} for
 * "walk every table" consumers, {@link findTableByCoord} for
 * `(namespaceId, name)` lookups, and {@link findTableByName} as the
 * legacy name-only lookup (throws when the name is ambiguous across
 * namespaces).
 *
 * The `types` slot follows the same dual-view contract: `types` is
 * the flat-by-name view, `typesByNamespace` is the FR15 nested truth.
 *
 * `tablesByNamespace` and `typesByNamespace` are declared optional in
 * the type so user-facing emitted contract types — built bottom-up by
 * the emitter / `defineContract` from the flat `tables` shape — remain
 * structurally assignable to `Contract<SqlStorage>`. Reads via the
 * helpers transparently fall back to wrapping the flat view under the
 * unbound namespace when the nested view is absent.
 */
export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Readonly<Record<string, StorageTable>>;
  declare readonly tablesByNamespace?: Readonly<
    Record<string, Readonly<Record<string, StorageTable>>>
  >;
  readonly namespaces: Readonly<Record<string, Namespace>>;
  // SQL-family slot view: the two structural variants the family ships
  // today (codec triples + Postgres-enum structural entries). Each
  // variant extends the framework `StorageType` alphabet; the SQL
  // narrowing keeps cross-domain layering clean — SQL-family consumers
  // dispatch via `isStorageTypeInstance` / `isPostgresEnumStorageEntry`
  // type guards rather than importing the target's concrete IR class
  // (cross-domain rule: SQL may not import `target-*`).
  declare readonly types?: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
  declare readonly typesByNamespace?: Readonly<
    Record<string, Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>>
  >;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    const nestedTables = normaliseTablesInput(input.tables);
    Object.defineProperty(this, 'tablesByNamespace', {
      value: freezeNestedTables(nestedTables),
      // Non-enumerable: the nested view is an in-memory derived projection
      // of the flat `tables` view; the JSON envelope on disk mirrors the
      // flat shape (single-namespace contracts) for byte-identity. The
      // canonicalisation walk and JSON.stringify therefore skip this
      // property; consumers reach it via the explicit `iterateTables*` /
      // `findTableByCoord` helpers.
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.tables = freezeFlatTablesView(nestedTables);
    this.namespaces = input.namespaces ?? DEFAULT_NAMESPACES;
    if (input.types !== undefined) {
      const nestedTypes = normaliseTypesInput(input.types);
      Object.defineProperty(this, 'typesByNamespace', {
        value: freezeNestedTypes(nestedTypes),
        enumerable: false,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(this, 'types', {
        value: freezeFlatTypesView(nestedTypes),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    freezeNode(this);
  }
}

/**
 * JSON envelope projection. Defaults to the legacy flat shape so
 * the 32 existing single-namespace fixtures stay byte-identical and
 * multi-namespace contracts with distinct table names per namespace
 * persist their `StorageTable.namespaceId` back-pointer enumerably.
 *
 * The envelope escalates to the FR15 nested shape (`{ [namespaceId]:
 * { [tableName]: StorageTable } }`) only when the flat shape cannot
 * round-trip without losing data — i.e. when the same table name
 * appears in two or more namespace buckets (e.g. `auth.User` +
 * `public.User`). Persisting both entries under one flat key is
 * impossible by definition; the nested shape is the one envelope
 * that can carry the collision.
 *
 * `validateStorage` discriminates between the two shapes at the
 * runtime entry point and the constructor normalises both back into
 * the dual-view IR, so the round-trip is lossless in either
 * direction.
 *
 * Installed via `Object.defineProperty` (non-enumerable) on the
 * prototype rather than declared as a class member so the user-facing
 * `BuiltStorage<Definition>` type — which `defineContract` builds
 * bottom-up from the flat `tables` shape and which lacks a `toJSON`
 * method — remains structurally assignable to `SqlStorage`. The
 * `JSON.stringify` contract calls this method by name regardless of
 * whether it appears in the static type.
 */
Object.defineProperty(SqlStorage.prototype, 'toJSON', {
  value: function toJSON(this: SqlStorage): unknown {
    const nestedTables = this.tablesByNamespace ?? { [UNBOUND_NAMESPACE_ID]: this.tables };
    const nestedTypes = this.typesByNamespace;

    const useNestedTables = hasCrossNamespaceNameCollision(nestedTables);
    const useNestedTypes = nestedTypes ? hasCrossNamespaceNameCollision(nestedTypes) : false;
    const useNested = useNestedTables || useNestedTypes;

    const envelope: Record<string, unknown> = {
      storageHash: this.storageHash,
      tables: useNested ? nestedTables : this.tables,
      namespaces: this.namespaces,
    };
    if (this.types !== undefined) {
      envelope['types'] = useNested && nestedTypes !== undefined ? nestedTypes : this.types;
    }
    return envelope;
  },
  enumerable: false,
  writable: false,
  configurable: false,
});

/**
 * Detect whether any entry name appears in two or more namespace
 * buckets — the only condition under which the flat-by-name envelope
 * cannot carry every entry without losing data.
 */
function hasCrossNamespaceNameCollision(
  nested: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): boolean {
  const seen = new Set<string>();
  for (const bucket of Object.values(nested)) {
    for (const name of Object.keys(bucket)) {
      if (seen.has(name)) return true;
      seen.add(name);
    }
  }
  return false;
}

/**
 * Discriminate between the legacy flat `tables` input shape and the
 * FR15 nested-by-namespace input shape, then normalise to the nested
 * in-memory shape. A flat input is detected by spotting an immediate
 * value that "looks like a table" (a `StorageTable` instance, or an
 * input object carrying the `columns` field). A nested input has
 * record-of-records values.
 */
function normaliseTablesInput(
  input: SqlStorageTablesFlatInput | SqlStorageTablesNestedInput,
): Record<string, Record<string, StorageTable>> {
  if (isFlatTablesInput(input)) {
    const result: Record<string, Record<string, StorageTable>> = {};
    for (const [name, entry] of Object.entries(input)) {
      const table = entry instanceof StorageTable ? entry : new StorageTable(entry);
      const namespaceId = table.namespaceId ?? UNBOUND_NAMESPACE_ID;
      if (result[namespaceId] === undefined) {
        result[namespaceId] = {};
      }
      const bucket = result[namespaceId];
      if (Object.hasOwn(bucket, name)) {
        throw new Error(
          `SqlStorage: table "${name}" appears twice in namespace "${namespaceId}". The legacy flat input shape cannot express same-named tables across namespaces; rewrite as the nested \`Record<namespaceId, Record<tableName, StorageTable>>\` shape.`,
        );
      }
      bucket[name] = table;
    }
    return result;
  }
  const result: Record<string, Record<string, StorageTable>> = {};
  for (const [namespaceId, bucketInput] of Object.entries(input)) {
    const bucket: Record<string, StorageTable> = {};
    for (const [name, entry] of Object.entries(bucketInput)) {
      const table = entry instanceof StorageTable ? entry : new StorageTable(entry);
      const explicit = table.namespaceId;
      if (explicit !== undefined && explicit !== namespaceId) {
        throw new Error(
          `SqlStorage: table "${name}" carries namespaceId "${explicit}" but is keyed under namespace "${namespaceId}". The nested map key must agree with the back-pointer (or omit the back-pointer).`,
        );
      }
      bucket[name] = table;
    }
    result[namespaceId] = bucket;
  }
  return result;
}

function isFlatTablesInput(
  input: SqlStorageTablesFlatInput | SqlStorageTablesNestedInput,
): input is SqlStorageTablesFlatInput {
  for (const value of Object.values(input)) {
    if (value instanceof StorageTable) return true;
    if (
      typeof value === 'object' &&
      value !== null &&
      'columns' in (value as Record<string, unknown>)
    ) {
      return true;
    }
    return false;
  }
  // Empty input — treat as flat (no tables).
  return true;
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

/**
 * Build the flat-by-name view from the nested-by-namespace truth.
 * Single-namespace contracts flatten 1:1. Multi-namespace contracts
 * that reuse a table name across namespaces pick the **first** entry
 * encountered (iteration order across the nested map's keys); the
 * second is hidden from the flat view. Consumers needing the
 * collision-free truth must read `tablesByNamespace` directly.
 */
function freezeFlatTablesView(
  nested: Record<string, Record<string, StorageTable>>,
): Readonly<Record<string, StorageTable>> {
  const flat: Record<string, StorageTable> = {};
  for (const bucket of Object.values(nested)) {
    for (const [name, table] of Object.entries(bucket)) {
      if (!Object.hasOwn(flat, name)) {
        flat[name] = table;
      }
    }
  }
  return Object.freeze(flat);
}

function normaliseTypesInput(
  input: SqlStorageTypesFlatInput | SqlStorageTypesNestedInput,
): Record<string, Record<string, StorageTypeInstance | PostgresEnumStorageEntry>> {
  if (isFlatTypesInput(input)) {
    const bucket: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {};
    for (const [name, entry] of Object.entries(input)) {
      bucket[name] = normaliseTypeEntry(entry);
    }
    return { [UNBOUND_NAMESPACE_ID]: bucket };
  }
  const out: Record<string, Record<string, StorageTypeInstance | PostgresEnumStorageEntry>> = {};
  for (const [namespaceId, bucketInput] of Object.entries(input)) {
    const bucket: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {};
    for (const [name, entry] of Object.entries(bucketInput)) {
      bucket[name] = normaliseTypeEntry(entry);
    }
    out[namespaceId] = bucket;
  }
  return out;
}

function isFlatTypesInput(
  input: SqlStorageTypesFlatInput | SqlStorageTypesNestedInput,
): input is SqlStorageTypesFlatInput {
  for (const value of Object.values(input)) {
    if (typeof value !== 'object' || value === null) return true;
    if ('kind' in (value as Record<string, unknown>)) return true;
    if ('codecId' in (value as Record<string, unknown>)) return true;
    return false;
  }
  return true;
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

function freezeFlatTypesView(
  nested: Record<string, Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
): Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>> {
  const flat: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {};
  for (const bucket of Object.values(nested)) {
    for (const [name, entry] of Object.entries(bucket)) {
      if (!Object.hasOwn(flat, name)) {
        flat[name] = entry;
      }
    }
  }
  return Object.freeze(flat);
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
 * Read the nested-by-namespace view of a storage's tables. Falls back
 * to wrapping the flat-by-name view under the unbound namespace when
 * the storage's nested view is absent — the case for user-facing
 * contract type structures the emitter / `defineContract` builds
 * bottom-up from the flat `tables` shape (these structurally satisfy
 * `SqlStorage` but don't round-trip through the runtime constructor).
 */
function nestedTablesView(
  storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>,
): Readonly<Record<string, Readonly<Record<string, StorageTable>>>> {
  return storage.tablesByNamespace ?? { [UNBOUND_NAMESPACE_ID]: storage.tables };
}

function nestedTypesView(
  storage: Pick<SqlStorage, 'types' | 'typesByNamespace'>,
): Readonly<
  Record<string, Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>>
> {
  if (storage.typesByNamespace !== undefined) return storage.typesByNamespace;
  if (storage.types !== undefined) return { [UNBOUND_NAMESPACE_ID]: storage.types };
  return {};
}

/**
 * Iterate every table in the storage's nested map. Yields the
 * `(namespaceId, name, table)` coordinate tuple — the most general
 * shape consumers need; sites that only want the table itself can
 * destructure `{ table }`.
 */
export function* iterateTablesWithCoords(
  storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>,
): IterableIterator<{
  readonly namespaceId: string;
  readonly name: string;
  readonly table: StorageTable;
}> {
  for (const [namespaceId, bucket] of Object.entries(nestedTablesView(storage))) {
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
  storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>,
): IterableIterator<StorageTable> {
  for (const bucket of Object.values(nestedTablesView(storage))) {
    for (const table of Object.values(bucket)) {
      yield table;
    }
  }
}

/**
 * Look up a table by name across every namespace bucket. Returns
 * `undefined` when no entry matches; throws when the same name appears
 * in more than one namespace (the caller is reading a multi-namespace
 * contract through a flat-name lookup that cannot disambiguate; supply
 * the namespace id via {@link findTableByCoord} or read
 * `tablesByNamespace` directly).
 */
export function findTableByName(
  storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>,
  name: string,
): StorageTable | undefined {
  let found: StorageTable | undefined;
  let foundIn: string | undefined;
  for (const [namespaceId, bucket] of Object.entries(nestedTablesView(storage))) {
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
  storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>,
  namespaceId: string,
  name: string,
): StorageTable | undefined {
  return nestedTablesView(storage)[namespaceId]?.[name];
}

/**
 * Number of tables across every namespace.
 */
export function countAllTables(storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>): number {
  let count = 0;
  for (const bucket of Object.values(nestedTablesView(storage))) {
    count += Object.keys(bucket).length;
  }
  return count;
}

/**
 * Return every table-name in the storage, regardless of namespace.
 * Sites that need namespace-aware iteration should switch to
 * {@link iterateTablesWithCoords}.
 */
export function listAllTableNames(
  storage: Pick<SqlStorage, 'tables' | 'tablesByNamespace'>,
): string[] {
  const names: string[] = [];
  for (const bucket of Object.values(nestedTablesView(storage))) {
    for (const name of Object.keys(bucket)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Iterate every type entry in the storage's nested map.
 */
export function* iterateTypesWithCoords(
  storage: Pick<SqlStorage, 'types' | 'typesByNamespace'>,
): IterableIterator<{
  readonly namespaceId: string;
  readonly name: string;
  readonly entry: StorageTypeInstance | PostgresEnumStorageEntry;
}> {
  for (const [namespaceId, bucket] of Object.entries(nestedTypesView(storage))) {
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
  storage: Pick<SqlStorage, 'types' | 'typesByNamespace'>,
  name: string,
): StorageTypeInstance | PostgresEnumStorageEntry | undefined {
  let found: StorageTypeInstance | PostgresEnumStorageEntry | undefined;
  let foundIn: string | undefined;
  for (const [namespaceId, bucket] of Object.entries(nestedTypesView(storage))) {
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
  storage: Pick<SqlStorage, 'types' | 'typesByNamespace'>,
  namespaceId: string,
  name: string,
): StorageTypeInstance | PostgresEnumStorageEntry | undefined {
  return nestedTypesView(storage)[namespaceId]?.[name];
}
