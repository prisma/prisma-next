import type { ColumnDefault } from '@prisma-next/contract/types';
import type { MigrationPlannerConflict } from '@prisma-next/core-control-plane/types';
import type {
  ForeignKey,
  Index,
  SqlStorage,
  StorageColumn,
  StorageTable,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import type {
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

function convertColumn(
  name: string,
  column: StorageColumn,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer,
): SqlColumnIR {
  const nativeType = expandNativeType
    ? expandNativeType({
        nativeType: column.nativeType,
        codecId: column.codecId,
        ...ifDefined('typeParams', column.typeParams),
      })
    : column.nativeType;
  return {
    name,
    nativeType,
    nullable: column.nullable,
    ...ifDefined(
      'default',
      column.default != null ? renderDefault(column.default, column) : undefined,
    ),
  };
}

function convertUnique(unique: UniqueConstraint): SqlUniqueIR {
  return {
    columns: unique.columns,
    ...(unique.name != null ? { name: unique.name } : {}),
  };
}

function convertIndex(index: Index): SqlIndexIR {
  return {
    columns: index.columns,
    unique: false,
    ...(index.name != null ? { name: index.name } : {}),
  };
}

function convertForeignKey(fk: ForeignKey): SqlForeignKeyIR {
  return {
    columns: fk.columns,
    referencedTable: fk.references.table,
    referencedColumns: fk.references.columns,
    ...(fk.name != null ? { name: fk.name } : {}),
  };
}

function convertTable(
  name: string,
  table: StorageTable,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer,
): SqlTableIR {
  const columns: Record<string, SqlColumnIR> = {};
  for (const [colName, colDef] of Object.entries(table.columns)) {
    columns[colName] = convertColumn(colName, colDef, expandNativeType, renderDefault);
  }

  return {
    name,
    columns,
    ...(table.primaryKey != null ? { primaryKey: table.primaryKey } : {}),
    foreignKeys: table.foreignKeys.map(convertForeignKey),
    uniques: table.uniques.map(convertUnique),
    indexes: table.indexes.map(convertIndex),
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

/**
 * Converts a contract's `SqlStorage` to `SqlSchemaIR`.
 *
 * Drops codec metadata (`codecId`, `typeRef`) since the schema IR only represents structural
 * information. When `expandNativeType` is provided, parameterized types are expanded
 * (e.g. `character` + `{ length: 36 }` → `character(36)`) so the resulting IR compares
 * correctly against the "to" contract during planning.
 *
 * `extensions` is always `[]` — the planner resolves extension dependencies from framework
 * components, and an empty array means "nothing installed yet" which is correct for the
 * "from" side of a diff.
 */
export function contractToSchemaIR(
  storage: SqlStorage,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer,
): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [tableName, tableDef] of Object.entries(storage.tables)) {
    tables[tableName] = convertTable(tableName, tableDef, expandNativeType, renderDefault);
  }

  return {
    tables,
    extensions: [],
  };
}
