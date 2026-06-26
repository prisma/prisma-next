import type { ColumnDefault, Contract, JsonValue } from '@prisma-next/contract/types';
import type { MigrationPlannerConflict } from '@prisma-next/framework-components/control';
import {
  type CheckConstraint,
  type ForeignKey,
  type Index,
  isStorageTable,
  isStorageTypeInstance,
  type SqlStorage,
  type StorageColumn,
  type StorageTable,
  type StorageTypeInstance,
  type UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type {
  SqlAnnotations,
  SqlCheckConstraintIRInput,
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
 * Target-supplied callback that resolves a contract namespace to the live
 * database schema its enums are stored under.
 *
 * The projected enum annotations are nested by schema
 * (`storageTypes[schema][nativeType]`) so two namespaces holding an enum with
 * the same native type resolve to distinct live-database types. Mapping a
 * namespace to its DDL schema is target-specific (Postgres schemas;
 * SQLite/MySQL differ), so the target injects it here rather than the family
 * importing a concrete `ddlSchemaName`. This keeps the family layer
 * target-agnostic while the projection nests under the same schema the
 * target's read side (`readExistingEnumValues`) looks up.
 */
export type EnumNamespaceSchemaResolver = (storage: SqlStorage, namespaceId: string) => string;

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
  const baseNativeType = expandNativeType
    ? expandNativeType({
        nativeType: resolved.nativeType,
        codecId: resolved.codecId,
        ...ifDefined('typeParams', resolved.typeParams),
      })
    : resolved.nativeType;
  const nativeType = column.many ? `${baseNativeType}[]` : baseNativeType;
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

type ResolvedStorageTypes = Readonly<Record<string, StorageTypeInstance>>;

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
  if (isStorageTypeInstance(referenced)) {
    return {
      codecId: referenced.codecId,
      nativeType: referenced.nativeType,
      typeParams: referenced.typeParams,
    };
  }
  throw new Error(
    `Storage type "${column.typeRef}" has an unknown polymorphic kind; expected a codec-typed StorageTypeInstance.`,
  );
}

/**
 * Resolves a `ValueSetRef` to its permitted values from the contract storage.
 *
 * Throws when the referenced namespace or value-set is absent — this indicates
 * the contract was built incorrectly (the check and the value-set must be
 * co-emitted by the lowering step). Used by `convertCheck` (schema-IR
 * projection), `verifyCheckConstraints` (verification), and
 * `checkConstraintPlanCallStrategy` (migration planning) so all three agree on
 * the resolved values and the error behavior on a missing reference.
 */
function allStrings(values: readonly JsonValue[]): values is readonly string[] {
  return values.every((value) => typeof value === 'string');
}

export function resolveValueSetValues(
  ref: { readonly namespaceId: string; readonly entityName: string },
  storage: SqlStorage,
  contextLabel: string,
): readonly string[] {
  const ns = storage.namespaces[ref.namespaceId];
  if (!ns) {
    throw new Error(
      `resolveValueSetValues: namespace "${ref.namespaceId}" not found in storage (${contextLabel})`,
    );
  }
  const valueSet = ns.entries.valueSet?.[ref.entityName];
  if (!valueSet) {
    throw new Error(
      `resolveValueSetValues: value-set "${ref.entityName}" not found in namespace "${ref.namespaceId}" (${contextLabel})`,
    );
  }
  // Only TEXT enums ship a CHECK-constraint round-trip in this slice. A
  // non-string value-set is a numeric enum, whose CHECK rendering/verification
  // is future work; fail loudly rather than emit a wrong numeric-as-text check.
  const values = valueSet.values;
  if (!allStrings(values)) {
    throw new Error(
      `resolveValueSetValues: value-set "${ref.entityName}" in namespace "${ref.namespaceId}" has a non-string value; numeric-enum CHECK constraints are not yet supported (${contextLabel})`,
    );
  }
  return values;
}

/**
 * Projects a `CheckConstraint` IR into an `SqlCheckConstraintIRInput` by
 * resolving the permitted values from the storage value-set it references.
 *
 * The `CheckConstraint.valueSet` ref points to
 * `storage.namespaces[namespaceId].entries.valueSet[name]`. The resolved
 * values are lifted directly from `StorageValueSet.values` so verification
 * compares value sets, not SQL predicate strings.
 *
 * Throws if the referenced namespace or value-set is absent — this
 * indicates the contract was built incorrectly (the check and the
 * value-set must be co-emitted by the lowering step).
 */
function convertCheck(check: CheckConstraint, storage: SqlStorage): SqlCheckConstraintIRInput {
  const permittedValues = resolveValueSetValues(check.valueSet, storage, `check "${check.name}"`);
  return {
    name: check.name,
    column: check.column,
    permittedValues,
  };
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
  storage: SqlStorage,
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

  const checks: SqlCheckConstraintIRInput[] | undefined =
    table.checks && table.checks.length > 0
      ? table.checks.map((c) => convertCheck(c, storage))
      : undefined;

  return {
    name,
    columns,
    ...ifDefined('primaryKey', table.primaryKey),
    foreignKeys: table.foreignKeys.filter((fk) => fk.constraint !== false).map(convertForeignKey),
    uniques: table.uniques.map(convertUnique),
    indexes: [...table.indexes.map(convertIndex), ...fkBackingIndexes],
    ...ifDefined('checks', checks),
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
    ...new Set([...Object.keys(from.namespaces), ...Object.keys(to.namespaces)]),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const namespaceId of namespaceIds) {
    const fromNs = from.namespaces[namespaceId];
    const toNs = to.namespaces[namespaceId];
    const fromTables = fromNs?.entries.table;
    if (!fromTables) continue;

    for (const tableName of Object.keys(fromTables)) {
      const toTableRaw = toNs?.entries.table?.[tableName];
      if (!isStorageTable(toTableRaw)) {
        conflicts.push({
          kind: 'tableRemoved',
          summary: `Table "${tableName}" was removed`,
        });
        continue;
      }
      const toTable = toTableRaw;

      const fromTableRaw = fromTables[tableName];
      if (!isStorageTable(fromTableRaw)) continue;
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
   * Target-supplied resolver mapping a namespace to the live database schema
   * its enums are stored under. When provided (Postgres), namespace-scoped
   * enums are nested by that schema in `enumTypes` so the projection matches
   * the target's `readExistingEnumValues` lookup. Targets without
   * schema-scoped enum storage (SQLite) omit it; enums are absent there.
   */
  readonly resolveEnumNamespaceSchema?: EnumNamespaceSchemaResolver;
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
  const storageTypes: ResolvedStorageTypes = {
    ...((storage.types ?? {}) as ResolvedStorageTypes),
  };
  const tables: Record<string, SqlTableIR> = {};
  for (const ns of Object.values(storage.namespaces)) {
    for (const [tableName, tableDefRaw] of Object.entries(ns.entries.table ?? {})) {
      if (!isStorageTable(tableDefRaw)) {
        throw new Error(
          `contractToSchemaIR: expected StorageTable at namespaces.${ns.id}.entries.table.${tableName}`,
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
        storage,
      );
    }
  }

  const annotations = deriveAnnotations(
    storage,
    options.annotationNamespace,
    options.resolveEnumNamespaceSchema,
  );

  return {
    tables,
    ...ifDefined('annotations', annotations),
  };
}

function deriveAnnotations(
  storage: SqlStorage,
  annotationNamespace: string,
  _resolveEnumNamespaceSchema: EnumNamespaceSchemaResolver | undefined,
): SqlAnnotations | undefined {
  const storageTypes: Record<string, StorageTypeInstance> = {};

  for (const typeInstance of Object.values((storage.types ?? {}) as ResolvedStorageTypes)) {
    if (isStorageTypeInstance(typeInstance)) {
      storageTypes[typeInstance.nativeType] = typeInstance;
    }
  }

  const envelope = {
    ...(Object.keys(storageTypes).length > 0 ? { storageTypes } : {}),
  };
  if (Object.keys(envelope).length === 0) return undefined;
  return { [annotationNamespace]: envelope };
}
