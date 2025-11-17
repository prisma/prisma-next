import type { ControlPlaneDriver } from '@prisma-next/core-control-plane/types';
import type {
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlTypeMetadataRegistry,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';

/**
 * Queries all tables in the specified schema.
 */
async function queryTables(
  driver: ControlPlaneDriver,
  schema: string,
): Promise<ReadonlyArray<string>> {
  const result = await driver.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  );
  return result.rows.map((row: { table_name: string }) => row.table_name);
}

/**
 * Queries columns for a specific table.
 */
async function queryColumns(
  driver: ControlPlaneDriver,
  schema: string,
  tableName: string,
): Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly dataType: string;
    readonly isNullable: boolean;
  }>
> {
  const result = await driver.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, tableName],
  );
  return result.rows.map(
    (row: { column_name: string; data_type: string; udt_name: string; is_nullable: string }) => {
      const databaseType = row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type;
      return {
        name: row.column_name,
        dataType: databaseType,
        isNullable: row.is_nullable === 'YES',
      };
    },
  );
}

/**
 * Queries primary key constraint for a specific table.
 * Returns both column names and constraint name to match ContractIR format.
 */
async function queryPrimaryKeys(
  driver: ControlPlaneDriver,
  schema: string,
  tableName: string,
): Promise<{ columns: readonly string[]; name?: string } | undefined> {
  const result = await driver.query<{ column_name: string; constraint_name: string }>(
    `SELECT kcu.column_name, tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [schema, tableName],
  );
  if (result.rows.length === 0) {
    return undefined;
  }
  const columns = result.rows.map((row: { column_name: string }) => row.column_name);
  const constraintName = result.rows[0]?.constraint_name;
  return {
    columns,
    ...(constraintName ? { name: constraintName } : {}),
  };
}

/**
 * Queries foreign key constraints for a specific table.
 */
async function queryForeignKeys(
  driver: ControlPlaneDriver,
  schema: string,
  tableName: string,
): Promise<
  ReadonlyArray<{
    readonly columns: readonly string[];
    readonly referencedTable: string;
    readonly referencedColumns: readonly string[];
    readonly constraintName: string;
  }>
> {
  const result = await driver.query<{
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    constraint_name: string;
    ordinal_position: number;
  }>(
    `SELECT
       kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name,
       tc.constraint_name,
       kcu.ordinal_position
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_name = tc.constraint_name
         AND rc.constraint_schema = tc.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = rc.unique_constraint_name
         AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schema, tableName],
  );

  // Group by constraint name
  const fkMap = new Map<
    string,
    {
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
      constraintName: string;
    }
  >();
  for (const row of result.rows) {
    const existing = fkMap.get(row.constraint_name);
    if (existing) {
      existing.columns.push(row.column_name);
      existing.referencedColumns.push(row.foreign_column_name);
    } else {
      fkMap.set(row.constraint_name, {
        columns: [row.column_name],
        referencedTable: row.foreign_table_name,
        referencedColumns: [row.foreign_column_name],
        constraintName: row.constraint_name,
      });
    }
  }

  return Array.from(fkMap.values()).map((fk) => ({
    columns: Object.freeze(fk.columns) as readonly string[],
    referencedTable: fk.referencedTable,
    referencedColumns: Object.freeze(fk.referencedColumns) as readonly string[],
    constraintName: fk.constraintName,
  }));
}

/**
 * Queries unique constraints for a specific table.
 */
async function queryUniqueConstraints(
  driver: ControlPlaneDriver,
  schema: string,
  tableName: string,
): Promise<
  ReadonlyArray<{
    readonly columns: readonly string[];
    readonly constraintName: string;
  }>
> {
  const result = await driver.query<{
    column_name: string;
    constraint_name: string;
    ordinal_position: number;
  }>(
    `SELECT kcu.column_name, tc.constraint_name, kcu.ordinal_position
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'UNIQUE'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schema, tableName],
  );

  // Group by constraint name
  const uniqueMap = new Map<string, { columns: string[]; constraintName: string }>();
  for (const row of result.rows) {
    const existing = uniqueMap.get(row.constraint_name);
    if (existing) {
      existing.columns.push(row.column_name);
    } else {
      uniqueMap.set(row.constraint_name, {
        columns: [row.column_name],
        constraintName: row.constraint_name,
      });
    }
  }

  return Array.from(uniqueMap.values()).map((u) => ({
    columns: Object.freeze(u.columns) as readonly string[],
    constraintName: u.constraintName,
  }));
}

/**
 * Queries indexes for a specific table.
 */
async function queryIndexes(
  driver: ControlPlaneDriver,
  schema: string,
  tableName: string,
): Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly columns: readonly string[];
    readonly isUnique: boolean;
  }>
> {
  const result = await driver.query<{
    index_name: string;
    column_name: string | null;
    is_unique: boolean;
  }>(
    `SELECT
       i.relname AS index_name,
       a.attname AS column_name,
       ix.indisunique AS is_unique
     FROM pg_index ix
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
     WHERE n.nspname = $1
       AND t.relname = $2
       AND NOT ix.indisprimary
     ORDER BY i.relname, array_position(ix.indkey, a.attnum)`,
    [schema, tableName],
  );

  // Group by index name
  const indexMap = new Map<string, { name: string; columns: string[]; isUnique: boolean }>();
  for (const row of result.rows) {
    if (!row.column_name) {
      continue;
    }
    const existing = indexMap.get(row.index_name);
    if (existing) {
      existing.columns.push(row.column_name);
    } else {
      indexMap.set(row.index_name, {
        name: row.index_name,
        columns: [row.column_name],
        isUnique: row.is_unique,
      });
    }
  }

  return Array.from(indexMap.values()).map((idx) => ({
    name: idx.name,
    columns: Object.freeze(idx.columns) as readonly string[],
    isUnique: idx.isUnique,
  }));
}

/**
 * Queries installed PostgreSQL extensions.
 */
async function queryExtensions(driver: ControlPlaneDriver): Promise<ReadonlyArray<string>> {
  const result = await driver.query<{ extname: string }>(
    'SELECT extname FROM pg_extension ORDER BY extname',
  );
  return result.rows.map((row: { extname: string }) => row.extname);
}

/**
 * Maps a database type to a type ID and native type using the type metadata registry.
 * Returns the first matching metadata entry's typeId and the database's actual nativeType.
 * The nativeType returned is the database's actual type (e.g., 'character varying'),
 * not the metadata's canonical type (e.g., 'text').
 */
function mapDatabaseTypeToTypeMetadata(
  databaseType: string | undefined,
  types: SqlTypeMetadataRegistry,
): { typeId: string; nativeType: string } | undefined {
  if (!databaseType) {
    return undefined;
  }
  // Normalize database type (remove length/precision modifiers) for matching
  const normalizedDbType =
    databaseType.split('(')[0]?.toLowerCase().trim() ?? databaseType.toLowerCase().trim();
  // Preserve original database type for nativeType (before normalization)
  const originalDbType = databaseType.split('(')[0]?.trim() ?? databaseType.trim();

  // Try to find a metadata entry with matching nativeType
  for (const metadata of types.values()) {
    if (metadata.nativeType && metadata.nativeType.toLowerCase() === normalizedDbType) {
      return {
        typeId: metadata.typeId,
        nativeType: originalDbType, // Return database's actual type, not metadata's canonical type
      };
    }
  }

  // Fallback: try to match by common type aliases
  const typeAliases: Record<string, string[]> = {
    integer: ['int4', 'int', 'int2', 'int8', 'smallint', 'bigint'],
    text: ['text', 'varchar', 'character varying', 'char', 'character'],
    boolean: ['boolean', 'bool'],
    timestamp: [
      'timestamp',
      'timestamp without time zone',
      'timestamptz',
      'timestamp with time zone',
    ],
  };

  for (const [canonicalType, aliases] of Object.entries(typeAliases)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalizedDbType)) {
      // Try to find metadata for canonical type
      for (const metadata of types.values()) {
        if (metadata.nativeType && metadata.nativeType.toLowerCase() === canonicalType) {
          return {
            typeId: metadata.typeId,
            nativeType: originalDbType, // Return database's actual type, not metadata's canonical type
          };
        }
      }
    }
  }

  return undefined;
}

/**
 * Introspects a PostgreSQL database schema and returns a SqlSchemaIR.
 * This is the Postgres-specific implementation that queries PostgreSQL catalogs.
 *
 * @param driver - ControlPlaneDriver for executing queries
 * @param types - Type metadata registry for mapping database types to type IDs
 * @param contract - Optional contract to limit introspection to specific tables
 * @param schema - Database schema name (defaults to 'public')
 * @returns Promise resolving to SqlSchemaIR
 */
export async function introspectPostgresSchema(
  driver: ControlPlaneDriver,
  types: SqlTypeMetadataRegistry,
  contract?: unknown,
  schema = 'public',
): Promise<SqlSchemaIR> {
  // Query all tables (or filter by contract if provided)
  const allTables = await queryTables(driver, schema);
  const tablesToIntrospect = contract
    ? // If contract provided, only introspect tables in contract
      (() => {
        // Type guard to check if contract has storage.tables
        if (
          typeof contract === 'object' &&
          contract !== null &&
          'storage' in contract &&
          typeof contract.storage === 'object' &&
          contract.storage !== null &&
          'tables' in contract.storage &&
          typeof contract.storage.tables === 'object' &&
          contract.storage.tables !== null
        ) {
          return Object.keys(contract.storage.tables as Record<string, unknown>).filter(
            (tableName) => allTables.includes(tableName),
          );
        }
        return allTables;
      })()
    : allTables;

  // Query extensions
  const extensions = await queryExtensions(driver);

  // Introspect each table
  const tables: Record<string, SqlTableIR> = {};
  for (const tableName of tablesToIntrospect) {
    const [columns, primaryKey, foreignKeys, uniqueConstraints, indexes] = await Promise.all([
      queryColumns(driver, schema, tableName),
      queryPrimaryKeys(driver, schema, tableName),
      queryForeignKeys(driver, schema, tableName),
      queryUniqueConstraints(driver, schema, tableName),
      queryIndexes(driver, schema, tableName),
    ]);

    // Map columns to SqlColumnIR
    const columnIRs: Record<string, SqlColumnIR> = {};
    for (const column of columns) {
      const typeInfo = mapDatabaseTypeToTypeMetadata(column.dataType, types);
      columnIRs[column.name] = {
        name: column.name,
        typeId: typeInfo?.typeId ?? column.dataType, // Fallback to database type if no metadata found
        ...(typeInfo?.nativeType ? { nativeType: typeInfo.nativeType } : {}),
        nullable: column.isNullable,
      };
    }

    // Map foreign keys to SqlForeignKeyIR
    const foreignKeyIRs: SqlForeignKeyIR[] = foreignKeys.map((fk) => ({
      columns: fk.columns,
      referencedTable: fk.referencedTable,
      referencedColumns: fk.referencedColumns,
      ...(fk.constraintName ? { name: fk.constraintName } : {}),
    }));

    // Map unique constraints to SqlUniqueIR
    const uniqueIRs: SqlUniqueIR[] = uniqueConstraints.map((u) => ({
      columns: u.columns,
      ...(u.constraintName ? { name: u.constraintName } : {}),
    }));

    // Map indexes to SqlIndexIR
    const indexIRs: SqlIndexIR[] = indexes.map((idx) => ({
      columns: idx.columns,
      unique: idx.isUnique,
      ...(idx.name ? { name: idx.name } : {}),
    }));

    tables[tableName] = {
      name: tableName,
      columns: columnIRs,
      ...(primaryKey ? { primaryKey: Object.freeze(primaryKey) } : {}),
      foreignKeys: Object.freeze(foreignKeyIRs) as readonly SqlForeignKeyIR[],
      uniques: Object.freeze(uniqueIRs) as readonly SqlUniqueIR[],
      indexes: Object.freeze(indexIRs) as readonly SqlIndexIR[],
    };
  }

  return {
    tables,
    extensions: Object.freeze(extensions) as readonly string[],
  };
}
