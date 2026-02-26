import type { ColumnDefault } from '@prisma-next/contract/types';
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
  return def.expression;
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
