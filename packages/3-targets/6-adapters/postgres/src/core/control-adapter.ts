import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type {
  DependencyIR,
  PrimaryKey,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlReferentialAction,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { parsePostgresDefault } from './default-normalizer';
import { pgEnumControlHooks } from './enum-control-hooks';

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
   * Target-specific normalizer for raw Postgres default expressions.
   * Used by schema verification to normalize raw defaults before comparison.
   */
  readonly normalizeDefault = parsePostgresDefault;

  /**
   * Target-specific normalizer for Postgres schema native type names.
   * Used by schema verification to normalize introspected type names
   * before comparison with contract native types.
   */
  readonly normalizeNativeType = normalizeSchemaNativeType;

  /**
   * Introspects a Postgres database schema and returns a raw SqlSchemaIR.
   *
   * This is a pure schema discovery operation that queries the Postgres catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * Uses batched queries to minimize database round trips (7 queries instead of 5T+3).
   *
   * @param driver - ControlDriverInstance<'sql', 'postgres'> instance for executing queries
   * @param contractIR - Optional contract IR for contract-guided introspection (filtering, optimization)
   * @param schema - Schema name to introspect (defaults to 'public')
   * @returns Promise resolving to SqlSchemaIR representing the live database schema
   */
  async introspect(
    driver: ControlDriverInstance<'sql', 'postgres'>,
    _contractIR?: unknown,
    schema = 'public',
  ): Promise<SqlSchemaIR> {
    // Execute all queries in parallel for efficiency (7 queries instead of 5T+3)
    const [
      tablesResult,
      columnsResult,
      pkResult,
      fkResult,
      uniqueResult,
      indexResult,
      extensionsResult,
    ] = await Promise.all([
      // Query all tables
      driver.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schema],
      ),
      // Query all columns for all tables in schema
      driver.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
        column_default: string | null;
        formatted_type: string | null;
      }>(
        `SELECT
           c.table_name,
           column_name,
           data_type,
           udt_name,
           is_nullable,
           character_maximum_length,
           numeric_precision,
           numeric_scale,
           column_default,
           format_type(a.atttypid, a.atttypmod) AS formatted_type
         FROM information_schema.columns c
         JOIN pg_catalog.pg_class cl
           ON cl.relname = c.table_name
         JOIN pg_catalog.pg_namespace ns
           ON ns.nspname = c.table_schema
           AND ns.oid = cl.relnamespace
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = cl.oid
           AND a.attname = c.column_name
           AND a.attnum > 0
           AND NOT a.attisdropped
         WHERE c.table_schema = $1
         ORDER BY c.table_name, c.ordinal_position`,
        [schema],
      ),
      // Query all primary keys for all tables in schema
      driver.query<{
        table_name: string;
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
      }>(
        `SELECT
           tc.table_name,
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY tc.table_name, kcu.ordinal_position`,
        [schema],
      ),
      // Query all foreign keys for all tables in schema, including referential actions.
      // Uses pg_catalog for correct positional pairing of composite FK columns
      // (information_schema.constraint_column_usage lacks ordinal_position,
      // which causes Cartesian products for multi-column FKs).
      driver.query<{
        table_name: string;
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
        referenced_table_schema: string;
        referenced_table_name: string;
        referenced_column_name: string;
        delete_rule: string;
        update_rule: string;
      }>(
        `SELECT
           tc.table_name,
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position,
           ref_ns.nspname AS referenced_table_schema,
           ref_cl.relname AS referenced_table_name,
           ref_att.attname AS referenced_column_name,
           rc.delete_rule,
           rc.update_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         JOIN pg_catalog.pg_constraint pgc
           ON pgc.conname = tc.constraint_name
           AND pgc.connamespace = (
             SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = tc.table_schema
           )
         JOIN pg_catalog.pg_class ref_cl
           ON ref_cl.oid = pgc.confrelid
         JOIN pg_catalog.pg_namespace ref_ns
           ON ref_ns.oid = ref_cl.relnamespace
         JOIN pg_catalog.pg_attribute ref_att
           ON ref_att.attrelid = pgc.confrelid
           AND ref_att.attnum = pgc.confkey[kcu.ordinal_position]
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
           AND rc.constraint_schema = tc.table_schema
         WHERE tc.table_schema = $1
           AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
        [schema],
      ),
      // Query all unique constraints for all tables in schema (excluding PKs)
      driver.query<{
        table_name: string;
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
      }>(
        `SELECT
           tc.table_name,
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.constraint_type = 'UNIQUE'
         ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
        [schema],
      ),
      // Query all indexes for all tables in schema (excluding constraints)
      driver.query<{
        tablename: string;
        indexname: string;
        indisunique: boolean;
        attname: string;
        attnum: number;
      }>(
        `SELECT
           i.tablename,
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
           AND NOT EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             WHERE tc.table_schema = $1
               AND tc.table_name = i.tablename
               AND tc.constraint_name = i.indexname
           )
         ORDER BY i.tablename, i.indexname, a.attnum`,
        [schema],
      ),
      // Query extensions
      driver.query<{ extname: string }>(
        `SELECT extname
         FROM pg_extension
         ORDER BY extname`,
        [],
      ),
    ]);

    // Group results by table name for efficient lookup
    const columnsByTable = groupBy(columnsResult.rows, 'table_name');
    const pksByTable = groupBy(pkResult.rows, 'table_name');
    const fksByTable = groupBy(fkResult.rows, 'table_name');
    const uniquesByTable = groupBy(uniqueResult.rows, 'table_name');
    const indexesByTable = groupBy(indexResult.rows, 'tablename');

    // Get set of PK constraint names per table (to exclude from uniques)
    const pkConstraintsByTable = new Map<string, Set<string>>();
    for (const row of pkResult.rows) {
      let constraints = pkConstraintsByTable.get(row.table_name);
      if (!constraints) {
        constraints = new Set();
        pkConstraintsByTable.set(row.table_name, constraints);
      }
      constraints.add(row.constraint_name);
    }

    const tables: Record<string, SqlTableIR> = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;

      // Process columns for this table
      const columns: Record<string, SqlColumnIR> = {};
      for (const colRow of columnsByTable.get(tableName) ?? []) {
        let nativeType = colRow.udt_name;
        const formattedType = colRow.formatted_type
          ? normalizeFormattedType(colRow.formatted_type, colRow.data_type, colRow.udt_name)
          : null;
        if (formattedType) {
          nativeType = formattedType;
        } else if (colRow.data_type === 'character varying' || colRow.data_type === 'character') {
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
          ...ifDefined('default', colRow.column_default ?? undefined),
        };
      }

      // Process primary key
      const pkRows = [...(pksByTable.get(tableName) ?? [])];
      const primaryKeyColumns = pkRows
        .sort((a, b) => a.ordinal_position - b.ordinal_position)
        .map((row) => row.column_name);
      const primaryKey: PrimaryKey | undefined =
        primaryKeyColumns.length > 0
          ? {
              columns: primaryKeyColumns,
              ...(pkRows[0]?.constraint_name ? { name: pkRows[0].constraint_name } : {}),
            }
          : undefined;

      // Process foreign keys
      const foreignKeysMap = new Map<
        string,
        {
          columns: string[];
          referencedTable: string;
          referencedColumns: string[];
          name: string;
          deleteRule: string;
          updateRule: string;
        }
      >();
      for (const fkRow of fksByTable.get(tableName) ?? []) {
        const existing = foreignKeysMap.get(fkRow.constraint_name);
        if (existing) {
          existing.columns.push(fkRow.column_name);
          existing.referencedColumns.push(fkRow.referenced_column_name);
        } else {
          foreignKeysMap.set(fkRow.constraint_name, {
            columns: [fkRow.column_name],
            referencedTable: fkRow.referenced_table_name,
            referencedColumns: [fkRow.referenced_column_name],
            name: fkRow.constraint_name,
            deleteRule: fkRow.delete_rule,
            updateRule: fkRow.update_rule,
          });
        }
      }
      const foreignKeys: readonly SqlForeignKeyIR[] = Array.from(foreignKeysMap.values()).map(
        (fk) => ({
          columns: Object.freeze([...fk.columns]) as readonly string[],
          referencedTable: fk.referencedTable,
          referencedColumns: Object.freeze([...fk.referencedColumns]) as readonly string[],
          name: fk.name,
          ...ifDefined('onDelete', mapReferentialAction(fk.deleteRule)),
          ...ifDefined('onUpdate', mapReferentialAction(fk.updateRule)),
        }),
      );

      // Process unique constraints (excluding those that are also PKs)
      const pkConstraints = pkConstraintsByTable.get(tableName) ?? new Set();
      const uniquesMap = new Map<string, { columns: string[]; name: string }>();
      for (const uniqueRow of uniquesByTable.get(tableName) ?? []) {
        // Skip if this constraint is also a primary key
        if (pkConstraints.has(uniqueRow.constraint_name)) {
          continue;
        }
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

      // Process indexes
      const indexesMap = new Map<string, { columns: string[]; name: string; unique: boolean }>();
      for (const idxRow of indexesByTable.get(tableName) ?? []) {
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
        ...ifDefined('primaryKey', primaryKey),
        foreignKeys,
        uniques,
        indexes,
      };
    }

    const dependencies: readonly DependencyIR[] = extensionsResult.rows.map((row) => ({
      id: `postgres.extension.${row.extname}`,
    }));

    const storageTypes =
      (await pgEnumControlHooks.introspectTypes?.({ driver, schemaName: schema })) ?? {};

    const annotations = {
      pg: {
        schema,
        version: await this.getPostgresVersion(driver),
        ...ifDefined(
          'storageTypes',
          Object.keys(storageTypes).length > 0 ? storageTypes : undefined,
        ),
      },
    };

    return {
      tables,
      dependencies,
      annotations,
    };
  }

  /**
   * Gets the Postgres version from the database.
   */
  private async getPostgresVersion(
    driver: ControlDriverInstance<'sql', 'postgres'>,
  ): Promise<string> {
    const result = await driver.query<{ version: string }>('SELECT version() AS version', []);
    const versionString = result.rows[0]?.version ?? '';
    // Extract version number from "PostgreSQL 15.1 ..." format
    const match = versionString.match(/PostgreSQL (\d+\.\d+)/);
    return match?.[1] ?? 'unknown';
  }
}

/**
 * Pre-computed lookup map for simple prefix-based type normalization.
 * Maps short Postgres type names to their canonical SQL names.
 * Using a Map for O(1) lookup instead of multiple startsWith checks.
 */
const TYPE_PREFIX_MAP: ReadonlyMap<string, string> = new Map([
  ['varchar', 'character varying'],
  ['bpchar', 'character'],
  ['varbit', 'bit varying'],
]);

/**
 * Normalizes a Postgres schema native type to its canonical form for comparison.
 *
 * Uses a pre-computed lookup map for simple prefix replacements (O(1))
 * and handles complex temporal type normalization separately.
 */
export function normalizeSchemaNativeType(nativeType: string): string {
  const trimmed = nativeType.trim();

  // Fast path: check simple prefix replacements using the lookup map
  for (const [prefix, replacement] of TYPE_PREFIX_MAP) {
    if (trimmed.startsWith(prefix)) {
      return replacement + trimmed.slice(prefix.length);
    }
  }

  // Temporal types with time zone handling
  // Check for 'with time zone' suffix first (more specific)
  if (trimmed.includes(' with time zone')) {
    if (trimmed.startsWith('timestamp')) {
      return `timestamptz${trimmed.slice(9).replace(' with time zone', '')}`;
    }
    if (trimmed.startsWith('time')) {
      return `timetz${trimmed.slice(4).replace(' with time zone', '')}`;
    }
  }

  // Handle 'without time zone' suffix - just strip it
  if (trimmed.includes(' without time zone')) {
    return trimmed.replace(' without time zone', '');
  }

  return trimmed;
}

function normalizeFormattedType(formattedType: string, dataType: string, udtName: string): string {
  if (formattedType === 'integer') {
    return 'int4';
  }
  if (formattedType === 'smallint') {
    return 'int2';
  }
  if (formattedType === 'bigint') {
    return 'int8';
  }
  if (formattedType === 'real') {
    return 'float4';
  }
  if (formattedType === 'double precision') {
    return 'float8';
  }
  if (formattedType === 'boolean') {
    return 'bool';
  }
  if (formattedType.startsWith('varchar')) {
    return formattedType.replace('varchar', 'character varying');
  }
  if (formattedType.startsWith('bpchar')) {
    return formattedType.replace('bpchar', 'character');
  }
  if (formattedType.startsWith('varbit')) {
    return formattedType.replace('varbit', 'bit varying');
  }
  if (dataType === 'timestamp with time zone' || udtName === 'timestamptz') {
    return formattedType.replace('timestamp', 'timestamptz').replace(' with time zone', '').trim();
  }
  if (dataType === 'timestamp without time zone' || udtName === 'timestamp') {
    return formattedType.replace(' without time zone', '').trim();
  }
  if (dataType === 'time with time zone' || udtName === 'timetz') {
    return formattedType.replace('time', 'timetz').replace(' with time zone', '').trim();
  }
  if (dataType === 'time without time zone' || udtName === 'time') {
    return formattedType.replace(' without time zone', '').trim();
  }
  // Only dataType === 'USER-DEFINED' should ever be quoted, but this should be safe without
  // checking that explicitly either way
  if (formattedType.startsWith('"') && formattedType.endsWith('"')) {
    return formattedType.slice(1, -1);
  }
  return formattedType;
}

/**
 * The five standard PostgreSQL referential action rules as returned by
 * `information_schema.referential_constraints.delete_rule` / `update_rule`.
 */
type PgReferentialActionRule = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

const PG_REFERENTIAL_ACTION_MAP: Record<PgReferentialActionRule, SqlReferentialAction> = {
  'NO ACTION': 'noAction',
  RESTRICT: 'restrict',
  CASCADE: 'cascade',
  'SET NULL': 'setNull',
  'SET DEFAULT': 'setDefault',
};

/**
 * Maps a Postgres referential action rule to the canonical SqlReferentialAction.
 * Returns undefined for 'NO ACTION' (the database default) to keep the IR sparse.
 * Throws for unrecognized rules to prevent silent data loss.
 */
function mapReferentialAction(rule: string): SqlReferentialAction | undefined {
  const mapped = PG_REFERENTIAL_ACTION_MAP[rule as PgReferentialActionRule];
  if (mapped === undefined) {
    throw new Error(
      `Unknown PostgreSQL referential action rule: "${rule}". Expected one of: NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT.`,
    );
  }
  if (mapped === 'noAction') return undefined;
  return mapped;
}

/**
 * Groups an array of objects by a specified key.
 * Returns a Map for O(1) lookup by group key.
 */
function groupBy<T, K extends keyof T>(items: readonly T[], key: K): Map<T[K], T[]> {
  const map = new Map<T[K], T[]>();
  for (const item of items) {
    const groupKey = item[key];
    let group = map.get(groupKey);
    if (!group) {
      group = [];
      map.set(groupKey, group);
    }
    group.push(item);
  }
  return map;
}
