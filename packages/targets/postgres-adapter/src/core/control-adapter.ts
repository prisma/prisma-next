import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type {
  PrimaryKey,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';

/**
 * Postgres control plane adapter for control-plane operations like introspection.
 * Provides target-specific implementations for control-plane domain actions.
 */
export class PostgresControlAdapter implements SqlControlAdapter<'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;
  /**
   * @deprecated Use targetId instead
   */
  readonly target = 'postgres' as const;

  /**
   * Introspects a Postgres database schema and returns a raw SqlSchemaIR.
   *
   * This is a pure schema discovery operation that queries the Postgres catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * @param driver - ControlDriverInstance<'postgres'> instance for executing queries
   * @param contractIR - Optional contract IR for contract-guided introspection (filtering, optimization)
   * @param schema - Schema name to introspect (defaults to 'public')
   * @returns Promise resolving to SqlSchemaIR representing the live database schema
   */
  async introspect(
    driver: ControlDriverInstance<'postgres'>,
    _contractIR?: unknown,
    schema = 'public',
  ): Promise<SqlSchemaIR> {
    // Query tables
    const tablesResult = await driver.query<{
      table_name: string;
    }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema],
    );

    const tables: Record<string, SqlTableIR> = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;

      // Query columns for this table
      const columnsResult = await driver.query<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }>(
        `SELECT
           column_name,
           data_type,
           udt_name,
           is_nullable,
           character_maximum_length,
           numeric_precision,
           numeric_scale
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, tableName],
      );

      const columns: Record<string, SqlColumnIR> = {};
      for (const colRow of columnsResult.rows) {
        // Build native type string from catalog data
        let nativeType = colRow.udt_name;
        if (colRow.data_type === 'character varying' || colRow.data_type === 'character') {
          if (colRow.character_maximum_length) {
            nativeType = `${colRow.data_type}(${colRow.character_maximum_length})`;
          } else {
            nativeType = colRow.data_type;
          }
        } else if (colRow.data_type === 'numeric' || colRow.data_type === 'decimal') {
          if (colRow.numeric_precision && colRow.numeric_scale !== null) {
            nativeType = `${colRow.data_type}(${colRow.numeric_precision},${colRow.numeric_scale})`;
          } else if (colRow.numeric_precision) {
            nativeType = `${colRow.data_type}(${colRow.numeric_precision})`;
          } else {
            nativeType = colRow.data_type;
          }
        } else {
          nativeType = colRow.udt_name || colRow.data_type;
        }

        columns[colRow.column_name] = {
          name: colRow.column_name,
          nativeType,
          nullable: colRow.is_nullable === 'YES',
        };
      }

      // Query primary key
      const pkResult = await driver.query<{
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
      }>(
        `SELECT
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position
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

      const primaryKeyColumns = pkResult.rows
        .sort((a, b) => a.ordinal_position - b.ordinal_position)
        .map((row) => row.column_name);
      const primaryKey: PrimaryKey | undefined =
        primaryKeyColumns.length > 0
          ? {
              columns: primaryKeyColumns,
              ...(pkResult.rows[0]?.constraint_name
                ? { name: pkResult.rows[0].constraint_name }
                : {}),
            }
          : undefined;

      // Query foreign keys
      const fkResult = await driver.query<{
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
        referenced_table_schema: string;
        referenced_table_name: string;
        referenced_column_name: string;
      }>(
        `SELECT
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position,
           ccu.table_schema AS referenced_table_schema,
           ccu.table_name AS referenced_table_name,
           ccu.column_name AS referenced_column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = $1
           AND tc.table_name = $2
           AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.constraint_name, kcu.ordinal_position`,
        [schema, tableName],
      );

      const foreignKeysMap = new Map<
        string,
        {
          columns: string[];
          referencedTable: string;
          referencedColumns: string[];
          name: string;
        }
      >();
      for (const fkRow of fkResult.rows) {
        const existing = foreignKeysMap.get(fkRow.constraint_name);
        if (existing) {
          // Multi-column FK - add column
          existing.columns.push(fkRow.column_name);
          existing.referencedColumns.push(fkRow.referenced_column_name);
        } else {
          foreignKeysMap.set(fkRow.constraint_name, {
            columns: [fkRow.column_name],
            referencedTable: fkRow.referenced_table_name,
            referencedColumns: [fkRow.referenced_column_name],
            name: fkRow.constraint_name,
          });
        }
      }
      const foreignKeys: readonly SqlForeignKeyIR[] = Array.from(foreignKeysMap.values()).map(
        (fk) => ({
          columns: Object.freeze([...fk.columns]) as readonly string[],
          referencedTable: fk.referencedTable,
          referencedColumns: Object.freeze([...fk.referencedColumns]) as readonly string[],
          name: fk.name,
        }),
      );

      // Query unique constraints (excluding PK)
      const uniqueResult = await driver.query<{
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
      }>(
        `SELECT
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.table_name = $2
           AND tc.constraint_type = 'UNIQUE'
           AND tc.constraint_name NOT IN (
             SELECT constraint_name
             FROM information_schema.table_constraints
             WHERE table_schema = $1
               AND table_name = $2
               AND constraint_type = 'PRIMARY KEY'
           )
         ORDER BY tc.constraint_name, kcu.ordinal_position`,
        [schema, tableName],
      );

      const uniquesMap = new Map<
        string,
        {
          columns: string[];
          name: string;
        }
      >();
      for (const uniqueRow of uniqueResult.rows) {
        const existing = uniquesMap.get(uniqueRow.constraint_name);
        if (existing) {
          existing.columns.push(uniqueRow.column_name);
        } else {
          uniquesMap.set(uniqueRow.constraint_name, {
            columns: [uniqueRow.column_name],
            name: uniqueRow.constraint_name,
          });
        }
      }
      const uniques: readonly SqlUniqueIR[] = Array.from(uniquesMap.values()).map((uq) => ({
        columns: Object.freeze([...uq.columns]) as readonly string[],
        name: uq.name,
      }));

      // Query indexes (excluding PK and unique constraints)
      const indexResult = await driver.query<{
        indexname: string;
        indisunique: boolean;
        attname: string;
        attnum: number;
      }>(
        `SELECT
           i.indexname,
           ix.indisunique,
           a.attname,
           a.attnum
         FROM pg_indexes i
         JOIN pg_class ic ON ic.relname = i.indexname
         JOIN pg_namespace ins ON ins.oid = ic.relnamespace AND ins.nspname = $1
         JOIN pg_index ix ON ix.indexrelid = ic.oid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace tn ON tn.oid = t.relnamespace AND tn.nspname = $1
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) AND a.attnum > 0
         WHERE i.schemaname = $1
           AND i.tablename = $2
           AND NOT EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             WHERE tc.table_schema = $1
               AND tc.table_name = $2
               AND tc.constraint_name = i.indexname
           )
         ORDER BY i.indexname, a.attnum`,
        [schema, tableName],
      );

      const indexesMap = new Map<
        string,
        {
          columns: string[];
          name: string;
          unique: boolean;
        }
      >();
      for (const idxRow of indexResult.rows) {
        // Skip rows where attname is null (system columns or invalid attnum)
        if (!idxRow.attname) {
          continue;
        }
        const existing = indexesMap.get(idxRow.indexname);
        if (existing) {
          existing.columns.push(idxRow.attname);
        } else {
          indexesMap.set(idxRow.indexname, {
            columns: [idxRow.attname],
            name: idxRow.indexname,
            unique: idxRow.indisunique,
          });
        }
      }
      const indexes: readonly SqlIndexIR[] = Array.from(indexesMap.values()).map((idx) => ({
        columns: Object.freeze([...idx.columns]) as readonly string[],
        name: idx.name,
        unique: idx.unique,
      }));

      tables[tableName] = {
        name: tableName,
        columns,
        ...(primaryKey ? { primaryKey } : {}),
        foreignKeys,
        uniques,
        indexes,
      };
    }

    // Query extensions
    const extensionsResult = await driver.query<{
      extname: string;
    }>(
      `SELECT extname
       FROM pg_extension
       ORDER BY extname`,
      [],
    );

    const extensions = extensionsResult.rows.map((row) => row.extname);

    // Build annotations with Postgres-specific metadata
    const annotations = {
      pg: {
        schema,
        version: await this.getPostgresVersion(driver),
      },
    };

    return {
      tables,
      extensions,
      annotations,
    };
  }

  /**
   * Gets the Postgres version from the database.
   */
  private async getPostgresVersion(driver: ControlDriverInstance<'postgres'>): Promise<string> {
    const result = await driver.query<{ version: string }>('SELECT version() AS version', []);
    const versionString = result.rows[0]?.version ?? '';
    // Extract version number from "PostgreSQL 15.1 ..." format
    const match = versionString.match(/PostgreSQL (\d+\.\d+)/);
    return match?.[1] ?? 'unknown';
  }
}
