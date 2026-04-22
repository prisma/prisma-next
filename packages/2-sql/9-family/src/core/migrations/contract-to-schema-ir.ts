import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { MigrationPlannerConflict } from '@prisma-next/framework-components/control';
import type {
  ForeignKey,
  Index,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type {
  DependencyIR,
  SqlAnnotations,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { collectInitDependencies } from './types';

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

function convertColumn(
  name: string,
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance>,
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

function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance>,
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
  return {
    codecId: referenced.codecId,
    nativeType: referenced.nativeType,
    typeParams: referenced.typeParams,
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
    columns: fk.columns,
    referencedTable: fk.references.table,
    referencedColumns: fk.references.columns,
    ...ifDefined('name', fk.name),
  };
}

function convertTable(
  name: string,
  table: StorageTable,
  storageTypes: Record<string, StorageTypeInstance>,
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
    const key = fk.columns.join(',');
    if (satisfiedIndexColumns.has(key)) continue;
    fkBackingIndexes.push({
      columns: fk.columns,
      unique: false,
      name: defaultIndexName(name, fk.columns),
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

  for (const tableName of Object.keys(from.tables)) {
    if (!hasOwn(to.tables, tableName)) {
      conflicts.push({
        kind: 'tableRemoved',
        summary: `Table "${tableName}" was removed`,
      });
      continue;
    }

    const toTable = to.tables[tableName] as StorageTable;
    const fromTable = from.tables[tableName];
    if (!fromTable) continue;

    for (const columnName of Object.keys(fromTable.columns)) {
      if (!hasOwn(toTable.columns, columnName)) {
        conflicts.push({
          kind: 'columnRemoved',
          summary: `Column "${tableName}"."${columnName}" was removed`,
        });
      }
    }
  }

  return conflicts;
}

export interface ContractToSchemaIROptions {
  readonly annotationNamespace: string;
  readonly expandNativeType?: NativeTypeExpander;
  readonly renderDefault?: DefaultRenderer;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/**
 * Converts a `Contract` to `SqlSchemaIR`.
 *
 * Reads `contract.storage` for tables, `contract.storage.types` for type
 * annotations, and derives database dependencies from `frameworkComponents`
 * (each component's `databaseDependencies.init[].id`).
 * Storage-type annotations are written under `options.annotationNamespace`.
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
    return { tables: {}, dependencies: [] };
  }

  const storage = contract.storage;
  const storageTypes = storage.types ?? {};
  const tables: Record<string, SqlTableIR> = {};
  for (const [tableName, tableDef] of Object.entries(storage.tables)) {
    tables[tableName] = convertTable(
      tableName,
      tableDef,
      storageTypes,
      options.expandNativeType,
      options.renderDefault,
    );
  }

  const dependencies = deduplicateDependencyIRs(
    collectInitDependencies(options.frameworkComponents ?? []),
  );
  const annotations = deriveAnnotations(storage, options.annotationNamespace);

  return {
    tables,
    dependencies,
    ...ifDefined('annotations', annotations),
  };
}

function deduplicateDependencyIRs(
  deps: readonly { readonly id: string }[],
): readonly DependencyIR[] {
  const seen = new Set<string>();
  const result: DependencyIR[] = [];
  for (const dep of deps) {
    if (dep.id.trim().length === 0) {
      throw new Error('Dependency id must be a non-empty string');
    }
    if (seen.has(dep.id)) continue;
    seen.add(dep.id);
    result.push({ id: dep.id });
  }
  return result;
}

function deriveAnnotations(
  storage: SqlStorage,
  annotationNamespace: string,
): SqlAnnotations | undefined {
  if (!storage.types || Object.keys(storage.types).length === 0) return undefined;
  // Re-key by nativeType to match the structure produced by introspection
  const byNativeType: Record<string, (typeof storage.types)[string]> = {};
  for (const typeInstance of Object.values(storage.types)) {
    byNativeType[typeInstance.nativeType] = typeInstance;
  }
  return { [annotationNamespace]: { storageTypes: byNativeType } };
}
