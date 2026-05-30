import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type { MigrationPlannerConflict } from '@prisma-next/framework-components/control';
import {
  getStorageNamespace,
  storageNamespaceEntries,
  storageNamespaceValues,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  type ForeignKey,
  type Index,
  isPostgresEnumStorageEntry,
  isStorageTypeInstance,
  type PostgresEnumStorageEntry,
  type SqlNamespace,
  type SqlStorage,
  type StorageColumn,
  StorageTable,
  type StorageTypeInstance,
  toStorageTypeInstance,
  type UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type {
  SqlAnnotations,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';

/**
 * Target-specific callback that expands a column's base `nativeType` and optional
 * `typeParams` into the fully-qualified type string used by the database
 * (e.g. `character` + `{ length: 36 }` → `character(36)`).
 *
 * This lives in the family layer as a callback rather than importing a concrete
 * implementation because each target (Postgres, MySQL, SQLite, …) has its own
 * parameterization syntax. The target wires its expander when calling
 * `contractToSchemaIR`, keeping the family layer target-agnostic.
 */
export type NativeTypeExpander = (input: {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}) => string;

/**
 * Target-specific callback that renders a `ColumnDefault` into the raw SQL literal
 * string stored in `SqlColumnIR.default`.
 *
 * Default value serialization is target-specific (quoting, casting, type syntax vary
 * between Postgres, MySQL, SQLite, …). This callback follows the same IoC pattern as
 * `NativeTypeExpander`: the target provides its renderer when calling
 * `contractToSchemaIR`, keeping the family layer target-agnostic.
 */
export type DefaultRenderer = (def: ColumnDefault, column: StorageColumn) => string;

/**
 * Target-supplied callback that computes the schema-qualified annotation-map
 * key for a namespace-scoped enum storage type.
 *
 * Enum lookups (`readExistingEnumValues`) are namespace/schema-qualified so two
 * namespaces holding an enum with the same TypeScript name (and even the same
 * native type) resolve to distinct live-database types. The *format* of that
 * key — and the namespace → DDL-schema resolution it depends on — is a
 * target-specific concern (Postgres schemas; SQLite/MySQL differ), so the
 * target injects it here as data rather than the family layer importing a
 * concrete `ddlSchemaName`/key implementation. This keeps the family layer
 * target-agnostic (no `@prisma-next/target-*` dependency) while the projection
 * still emits keys that match the target's read side exactly.
 */
export type EnumStorageKeyResolver = (
  storage: SqlStorage,
  namespaceId: string,
  nativeType: string,
) => string;

function convertColumn(
  name: string,
  column: StorageColumn,
  storageTypes: ResolvedStorageTypes,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer | undefined,
): SqlColumnIR {
  // Resolve `typeRef` so columns that delegate their `nativeType`/`codecId`/
  // `typeParams` to a named `storage.types` entry expand the same way as
  // columns that inline those fields. Without this resolution, a
  // `typeRef`-based column like `post.embedding → Embedding1536` would
  // render as the bare `"vector"` (dropping the `length` parameter), while
  // `verify-sql-schema.ts`'s `renderExpectedNativeType` resolves the
  // typeRef and produces `"vector(1536)"` — making diffs on the same
  // contract falsely report a `type_mismatch`.
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  const nativeType = expandNativeType
    ? expandNativeType({
        nativeType: resolved.nativeType,
        codecId: resolved.codecId,
        ...ifDefined('typeParams', resolved.typeParams),
      })
    : resolved.nativeType;
  return {
    name,
    nativeType,
    nullable: column.nullable,
    ...ifDefined(
      'default',
      column.default != null && renderDefault ? renderDefault(column.default, column) : undefined,
    ),
  };
}

/**
 * `storageTypes` is polymorphic per Decision 18 (Option B) — codec-typed
 * entries match `StorageTypeInstance`; enum entries match the structural
 * `PostgresEnumStorageEntry` shape (Postgres-only; cross-domain layering
 * keeps target IR classes out of the family layer). Both shapes resolve
 * into the same `(codecId, nativeType, typeParams)` triplet at the
 * column-resolution boundary so downstream walks stay uniform.
 */
type ResolvedStorageTypes = Readonly<
  Record<string, StorageTypeInstance | PostgresEnumStorageEntry>
>;

function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: ResolvedStorageTypes,
): Pick<StorageColumn, 'codecId' | 'nativeType' | 'typeParams'> {
  if (!column.typeRef) {
    return column;
  }
  const referenced = storageTypes[column.typeRef];
  if (!referenced) {
    throw new Error(
      `Column references storage type "${column.typeRef}" but it is not defined in storage.types.`,
    );
  }
  if (isPostgresEnumStorageEntry(referenced)) {
    return {
      codecId: referenced.codecId,
      nativeType: referenced.nativeType,
      typeParams: { values: referenced.values } as Record<string, unknown>,
    };
  }
  if (isStorageTypeInstance(referenced)) {
    return {
      codecId: referenced.codecId,
      nativeType: referenced.nativeType,
      typeParams: referenced.typeParams,
    };
  }
  throw new Error(
    `Storage type "${column.typeRef}" has an unknown polymorphic kind; expected codec-instance or postgres-enum.`,
  );
}

function convertUnique(unique: UniqueConstraint): SqlUniqueIR {
  return {
    columns: unique.columns,
    ...ifDefined('name', unique.name),
  };
}

function convertIndex(index: Index): SqlIndexIR {
  return {
    columns: index.columns,
    unique: false,
    ...ifDefined('name', index.name),
  };
}

function convertForeignKey(fk: ForeignKey): SqlForeignKeyIR {
  return {
    columns: fk.source.columns,
    referencedTable: fk.target.tableName,
    referencedSchema: fk.target.namespaceId,
    referencedColumns: fk.target.columns,
    ...ifDefined('name', fk.name),
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
}

function convertTable(
  name: string,
  table: StorageTable,
  storageTypes: ResolvedStorageTypes,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer | undefined,
): SqlTableIR {
  const columns: Record<string, SqlColumnIR> = {};
  for (const [colName, colDef] of Object.entries(table.columns)) {
    columns[colName] = convertColumn(
      colName,
      colDef,
      storageTypes,
      expandNativeType,
      renderDefault,
    );
  }

  const satisfiedIndexColumns = new Set([
    ...table.indexes.map((idx) => idx.columns.join(',')),
    ...table.uniques.map((unique) => unique.columns.join(',')),
    ...(table.primaryKey ? [table.primaryKey.columns.join(',')] : []),
  ]);
  const fkBackingIndexes: SqlIndexIR[] = [];
  for (const fk of table.foreignKeys) {
    if (fk.index === false) continue;
    const key = fk.source.columns.join(',');
    if (satisfiedIndexColumns.has(key)) continue;
    fkBackingIndexes.push({
      columns: fk.source.columns,
      unique: false,
      name: defaultIndexName(name, fk.source.columns),
    });
    satisfiedIndexColumns.add(key);
  }

  return {
    name,
    columns,
    ...ifDefined('primaryKey', table.primaryKey),
    foreignKeys: table.foreignKeys.map(convertForeignKey),
    uniques: table.uniques.map(convertUnique),
    indexes: [...table.indexes.map(convertIndex), ...fkBackingIndexes],
  };
}

/**
 * Detects destructive changes between two contract storages.
 *
 * The additive-only planner silently ignores removals (tables, columns).
 * This function detects those removals so callers can report them as conflicts
 * rather than silently producing an empty plan.
 *
 * Returns an empty array if no destructive changes are found.
 */
export function detectDestructiveChanges(
  from: SqlStorage | null,
  to: SqlStorage,
): readonly MigrationPlannerConflict[] {
  if (!from) return [];

  const hasOwn = (value: object, key: string): boolean => Object.hasOwn(value, key);

  const conflicts: MigrationPlannerConflict[] = [];

  const namespaceIds = [
    ...new Set([
      ...[...storageNamespaceEntries(from as unknown as Record<string, unknown>)].map(([id]) => id),
      ...[...storageNamespaceEntries(to as unknown as Record<string, unknown>)].map(([id]) => id),
    ]),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const namespaceId of namespaceIds) {
    const fromNs = getStorageNamespace(from as unknown as Record<string, unknown>, namespaceId) as
      | SqlNamespace
      | undefined;
    const toNs = getStorageNamespace(to as unknown as Record<string, unknown>, namespaceId) as
      | SqlNamespace
      | undefined;
    const fromTables = fromNs?.tables;
    if (!fromTables) continue;

    for (const tableName of Object.keys(fromTables)) {
      const toTableRaw = toNs?.tables[tableName];
      if (!(toTableRaw instanceof StorageTable)) {
        conflicts.push({
          kind: 'tableRemoved',
          summary: `Table "${tableName}" was removed`,
        });
        continue;
      }
      const toTable = toTableRaw;

      const fromTableRaw = fromTables[tableName];
      if (!(fromTableRaw instanceof StorageTable)) continue;
      const fromTable = fromTableRaw;

      for (const columnName of Object.keys(fromTable.columns)) {
        if (!hasOwn(toTable.columns, columnName)) {
          conflicts.push({
            kind: 'columnRemoved',
            summary: `Column "${tableName}"."${columnName}" was removed`,
          });
        }
      }
    }
  }

  return conflicts;
}

export interface ContractToSchemaIROptions {
  readonly annotationNamespace: string;
  readonly expandNativeType?: NativeTypeExpander;
  readonly renderDefault?: DefaultRenderer;
  /**
   * Target-supplied resolver for namespace/schema-qualified enum annotation
   * keys. When provided (Postgres), every namespace-scoped enum is keyed by the
   * resolver's output so the projected `storageTypes` map matches the target's
   * `readExistingEnumValues` lookup. Targets without namespace-qualified enum
   * storage (SQLite) omit it; enums are absent there.
   */
  readonly resolveEnumStorageKey?: EnumStorageKeyResolver;
}

/**
 * Converts a `Contract` to `SqlSchemaIR`.
 *
 * Reads `contract.storage` for tables and `contract.storage.types` for type
 * annotations. Storage-type annotations are written under
 * `options.annotationNamespace`.
 *
 * Drops codec metadata (`codecId`, `typeRef`) since the schema IR only represents
 * structural information. When `expandNativeType` is provided, parameterized types
 * are expanded (e.g. `character` + `{ length: 36 }` → `character(36)`) so the
 * resulting IR compares correctly against the "to" contract during planning.
 *
 * Returns an empty schema IR when `contract` is `null` (new project).
 */
export function contractToSchemaIR(
  contract: Contract<SqlStorage> | null,
  options: ContractToSchemaIROptions,
): SqlSchemaIR {
  if (options.annotationNamespace.length === 0) {
    throw new Error('annotationNamespace must be a non-empty string');
  }

  if (!contract) {
    return { tables: {} };
  }

  const storage = contract.storage;
  const allTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {
    ...((storage.types ?? {}) as ResolvedStorageTypes),
  };
  for (const ns of storageNamespaceValues(
    storage as unknown as Record<string, unknown>,
  ) as SqlNamespace[]) {
    const nsEnums = (ns as { enum?: Record<string, PostgresEnumStorageEntry> }).enum;
    if (nsEnums) {
      for (const [k, v] of Object.entries(nsEnums)) {
        allTypes[k] = v;
      }
    }
  }
  const storageTypes = allTypes as ResolvedStorageTypes;
  const tables: Record<string, SqlTableIR> = {};
  for (const ns of storageNamespaceValues(
    storage as unknown as Record<string, unknown>,
  ) as SqlNamespace[]) {
    for (const [tableName, tableDefRaw] of Object.entries(ns.tables)) {
      if (!(tableDefRaw instanceof StorageTable)) {
        throw new Error(
          `contractToSchemaIR: expected StorageTable at namespaces.${ns.id}.tables.${tableName}`,
        );
      }
      const tableDef = tableDefRaw;
      if (tables[tableName] !== undefined) {
        throw new Error(
          `contractToSchemaIR: duplicate SQL table name "${tableName}" across namespaces (ambiguous for flat SqlSchemaIR.tables).`,
        );
      }
      tables[tableName] = convertTable(
        tableName,
        tableDef,
        storageTypes,
        options.expandNativeType,
        options.renderDefault,
      );
    }
  }

  const annotations = deriveAnnotations(
    storage,
    options.annotationNamespace,
    options.resolveEnumStorageKey,
  );

  return {
    tables,
    ...ifDefined('annotations', annotations),
  };
}

/**
 * Normalises a native enum storage entry to the codec-typed annotation shape
 * `{codecId, nativeType, typeParams}` the introspector writes and
 * `readExistingEnumValues` reads (`existing.codecId` + `existing.typeParams.values`).
 * Without this the projector would emit the raw `PostgresEnumStorageEntry`
 * shape (top-level `values`, no `typeParams`) and the enum would read as new.
 */
function normalizeEnumAnnotation(entry: PostgresEnumStorageEntry): StorageTypeInstance {
  return toStorageTypeInstance({
    codecId: entry.codecId,
    nativeType: entry.nativeType,
    typeParams: { values: entry.values },
  });
}

function deriveAnnotations(
  storage: SqlStorage,
  annotationNamespace: string,
  resolveEnumStorageKey: EnumStorageKeyResolver | undefined,
): SqlAnnotations | undefined {
  const storageTypes: Record<string, StorageTypeInstance> = {};

  // Top-level `storage.types`: codec-typed entries (vector, decimal, …) keyed
  // by bare `nativeType` (unchanged). Post-S1.B enums live in
  // `namespaces[*].enum`, not here; a defensive top-level enum is still
  // namespace/schema-qualified via the resolver under the unbound coordinate
  // so it never collides on a bare name.
  for (const typeInstance of Object.values((storage.types ?? {}) as ResolvedStorageTypes)) {
    if (isPostgresEnumStorageEntry(typeInstance)) {
      const key = resolveEnumStorageKey
        ? resolveEnumStorageKey(storage, UNBOUND_NAMESPACE_ID, typeInstance.nativeType)
        : typeInstance.nativeType;
      storageTypes[key] = normalizeEnumAnnotation(typeInstance);
      continue;
    }
    if (isStorageTypeInstance(typeInstance)) {
      storageTypes[typeInstance.nativeType] = typeInstance;
    }
  }

  // Namespace-scoped enums: schema-qualified compound key matching the target's
  // `readExistingEnumValues` read side, so two namespaces sharing an enum name
  // (or native type) resolve to distinct live-database types.
  for (const [namespaceId, ns] of [
    ...storageNamespaceEntries(storage as unknown as Record<string, unknown>),
  ]) {
    const nsEnums = (ns as { enum?: Record<string, PostgresEnumStorageEntry> }).enum;
    if (!nsEnums) continue;
    for (const entry of Object.values(nsEnums)) {
      if (!isPostgresEnumStorageEntry(entry)) continue;
      const key = resolveEnumStorageKey
        ? resolveEnumStorageKey(storage, namespaceId, entry.nativeType)
        : entry.nativeType;
      storageTypes[key] = normalizeEnumAnnotation(entry);
    }
  }

  if (Object.keys(storageTypes).length === 0) return undefined;
  return { [annotationNamespace]: { storageTypes } };
}
