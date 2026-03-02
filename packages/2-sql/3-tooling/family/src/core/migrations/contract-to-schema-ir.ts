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

function convertDefault(def: ColumnDefault): string {
  if (def.kind === 'function') {
    return def.expression;
  }
  if (typeof def.value === 'string') {
    return `'${def.value}'`;
  }
  return String(def.value);
}

function convertColumn(name: string, column: StorageColumn): SqlColumnIR {
  const ir: SqlColumnIR = {
    name,
    nativeType: column.nativeType,
    nullable: column.nullable,
    ...(column.default != null ? { default: convertDefault(column.default) } : {}),
  };
  return ir;
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

function convertTable(name: string, table: StorageTable): SqlTableIR {
  const columns: Record<string, SqlColumnIR> = {};
  for (const [colName, colDef] of Object.entries(table.columns)) {
    columns[colName] = convertColumn(colName, colDef);
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

  const conflicts: MigrationPlannerConflict[] = [];

  for (const tableName of Object.keys(from.tables)) {
    const toTable = to.tables[tableName];
    if (!toTable) {
      conflicts.push({
        kind: 'tableRemoved',
        summary: `Table "${tableName}" was removed`,
      });
      continue;
    }

    const fromTable = from.tables[tableName];
    if (!fromTable) continue;

    for (const columnName of Object.keys(fromTable.columns)) {
      if (!toTable.columns[columnName]) {
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
 * This is a lossy conversion that drops codec metadata (`codecId`, `typeParams`, `typeRef`)
 * since the schema IR only represents structural information. The resulting schema IR can be
 * fed into the existing planner as the "from" state for offline migration planning.
 *
 * `extensions` is always `[]` — the planner resolves extension dependencies from framework
 * components, and an empty array means "nothing installed yet" which is correct for the
 * "from" side of a diff.
 */
export function contractToSchemaIR(storage: SqlStorage): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [tableName, tableDef] of Object.entries(storage.tables)) {
    tables[tableName] = convertTable(tableName, tableDef);
  }

  return {
    tables,
    extensions: [],
  };
}
