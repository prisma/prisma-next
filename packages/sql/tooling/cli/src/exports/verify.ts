import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { type } from 'arktype';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { assembleCodecRegistry } from '@prisma-next/cli/pack-assembly';
import { introspectPostgresSchema } from '@prisma-next/adapter-postgres/introspect';
import { verifyDatabaseSchema } from '@prisma-next/core-control-plane/verify-database-schema';
import sqlFamilyDescriptor from './cli';

const MetaSchema = type({ '[string]': 'unknown' });

function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
});

/**
 * Parses a contract marker row from database query result.
 * This is SQL-specific parsing logic (handles SQL row structure with snake_case columns).
 */
export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const validatedRow = result as {
    core_hash: string;
    profile_hash: string;
    contract_json?: unknown | null;
    canonical_version?: number | null;
    updated_at?: Date | string;
    app_tag?: string | null;
    meta?: unknown | null;
  };

  const updatedAt = validatedRow.updated_at
    ? validatedRow.updated_at instanceof Date
      ? validatedRow.updated_at
      : new Date(validatedRow.updated_at)
    : new Date();

  return {
    coreHash: validatedRow.core_hash,
    profileHash: validatedRow.profile_hash,
    contractJson: validatedRow.contract_json ?? null,
    canonicalVersion: validatedRow.canonical_version ?? null,
    updatedAt,
    appTag: validatedRow.app_tag ?? null,
    meta: parseMeta(validatedRow.meta),
  };
}

/**
 * Returns the SQL statement to read the contract marker.
 * This is a migration-plane helper (no runtime imports).
 * @internal - Used internally by readMarker(). Prefer readMarker() for Control Plane usage.
 */
export function readMarkerSql(): { readonly sql: string; readonly params: readonly unknown[] } {
  return {
    sql: `select
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta
    from prisma_contract.marker
    where id = $1`,
    params: [1],
  };
}

/**
 * Reads the contract marker from the database using the provided driver.
 * Returns the parsed marker record or null if no marker is found.
 * This abstracts SQL-specific details from the Control Plane.
 *
 * @param driver - ControlPlaneDriver instance for executing queries
 * @returns Promise resolving to ContractMarkerRecord or null if marker not found
 */
export async function readMarker(driver: ControlPlaneDriver): Promise<ContractMarkerRecord | null> {
  const markerStatement = readMarkerSql();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
  }>(markerStatement.sql, markerStatement.params);

  if (queryResult.rows.length === 0) {
    return null;
  }

  const markerRow = queryResult.rows[0];
  if (!markerRow) {
    // If rows array has length > 0 but first element is undefined, this is an unexpected result structure
    throw new Error('Database query returned unexpected result structure');
  }

  return parseContractMarkerRow(markerRow);
}

/**
 * Collects supported codec type IDs from adapter and extension manifests.
 * Returns a sorted, unique array of type IDs that are declared in the manifests.
 * This enables coverage checks by comparing contract column types against supported types.
 *
 * Note: This extracts type IDs from manifest type imports, not from runtime codec registries.
 * The manifests declare which codec types are available, but the actual type IDs
 * are defined in the codec-types TypeScript modules that are imported.
 *
 * For MVP, we return an empty array since extracting type IDs from TypeScript modules
 * would require runtime evaluation or static analysis. This can be enhanced later.
 */
export function collectSupportedCodecTypeIds(
  descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
): readonly string[] {
  // For MVP, return empty array
  // Future enhancement: Extract type IDs from codec-types modules via static analysis
  // or require manifests to explicitly list supported type IDs
  void descriptors;
  return [];
}

/**
 * Introspects the database schema and returns a target-agnostic SqlSchemaIR.
 * Delegates to Postgres adapter for concrete introspection.
 * This is the SQL family's implementation of the introspectSchema hook.
 */
export async function introspectSchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contractIR?: unknown;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
}): Promise<SqlSchemaIR> {
  const { driver, contractIR, adapter, extensions } = options;

  // Assemble codec registry from adapter + extensions
  const codecRegistry = await assembleCodecRegistry(adapter, extensions);

  // Delegate to Postgres adapter for concrete introspection
  // For now, we only support Postgres. In the future, this can branch on target.id
  if (options.target.id !== 'postgres') {
    throw new Error(`Schema introspection for target '${options.target.id}' is not yet supported`);
  }

  return introspectPostgresSchema(driver, codecRegistry, contractIR);
}

/**
 * Schema issue types for database schema verification.
 */
type SchemaIssue = {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'type_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
};

/**
 * Database schema information from PostgreSQL information schema.
 */
interface DatabaseTable {
  readonly name: string;
  readonly columns: ReadonlyArray<DatabaseColumn>;
  readonly primaryKey?: ReadonlyArray<string>;
  readonly foreignKeys: ReadonlyArray<DatabaseForeignKey>;
  readonly uniqueConstraints: ReadonlyArray<DatabaseUniqueConstraint>;
  readonly indexes: ReadonlyArray<DatabaseIndex>;
}

interface DatabaseColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isNullable: boolean;
}

interface DatabaseForeignKey {
  readonly columns: ReadonlyArray<string>;
  readonly referencedTable: string;
  readonly referencedColumns: ReadonlyArray<string>;
  readonly constraintName: string;
}

interface DatabaseUniqueConstraint {
  readonly columns: ReadonlyArray<string>;
  readonly constraintName: string;
}

interface DatabaseIndex {
  readonly name: string;
  readonly columns: ReadonlyArray<string>;
  readonly isUnique: boolean;
}

/**
 * Query runner interface for schema verification.
 */
interface QueryRunner {
  readonly query: <Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ readonly rows: Row[] }>;
  readonly close?: () => Promise<void>;
}

/**
 * PostgreSQL type compatibility mapping.
 * Maps logical type names to compatible database type names.
 *
 * Keys are "short" type identifiers (e.g. int4, text, timestamptz, vector).
 * Contract codec IDs like "pg/int4@1" are normalized to these keys before lookup.
 */
const TYPE_COMPATIBILITY: Record<string, ReadonlyArray<string>> = {
  // Integer types
  integer: ['int4', 'integer', 'int2', 'int8', 'smallint', 'bigint'],
  int: ['int4', 'integer', 'int2', 'int8', 'smallint', 'bigint'],
  int4: ['int4', 'integer'],
  int2: ['int2', 'smallint'],
  int8: ['int8', 'bigint'],
  smallint: ['int2', 'smallint'],
  bigint: ['int8', 'bigint'],
  // Text types
  text: ['text', 'varchar', 'character varying', 'char', 'character'],
  string: ['text', 'varchar', 'character varying', 'char', 'character'],
  varchar: ['varchar', 'character varying', 'text'],
  char: ['char', 'character', 'text'],
  // Boolean types
  boolean: ['boolean', 'bool'],
  bool: ['boolean', 'bool'],
  // Timestamp types
  timestamp: [
    'timestamp',
    'timestamp without time zone',
    'timestamptz',
    'timestamp with time zone',
  ],
  timestamptz: [
    'timestamptz',
    'timestamp with time zone',
    'timestamp',
    'timestamp without time zone',
  ],
  // Date types
  date: ['date'],
  // Numeric types
  numeric: ['numeric', 'decimal'],
  decimal: ['numeric', 'decimal'],
  // JSON types
  json: ['json', 'jsonb'],
  jsonb: ['jsonb', 'json'],
  // UUID types
  uuid: ['uuid'],
  // Binary types
  bytea: ['bytea'],
  // Vector types (pgvector)
  vector: ['vector'],
};

/**
 * Checks if a contract type is compatible with a database type.
 */
function isTypeCompatible(contractType: string, databaseType: string): boolean {
  // Normalize contract type:
  // - Strip codec namespace/version (e.g. "pg/int4@1" -> "int4")
  // - Remove length/precision modifiers
  let contractBase = contractType;
  const codecMatch = /^[^/]+\/([^@]+)@/.exec(contractType);
  if (codecMatch) {
    contractBase = codecMatch[1] ?? contractBase;
  }
  const normalizedContract =
    contractBase.split('(')[0]?.toLowerCase().trim() ?? contractBase.toLowerCase().trim();

  // Normalize database type (remove length/precision modifiers)
  const normalizedDatabase =
    databaseType.split('(')[0]?.toLowerCase().trim() ?? databaseType.toLowerCase().trim();

  // Exact match
  if (normalizedContract === normalizedDatabase) {
    return true;
  }

  // Check compatibility mapping
  const compatibleTypes = TYPE_COMPATIBILITY[normalizedContract];
  if (compatibleTypes) {
    return compatibleTypes.some((t) => t === normalizedDatabase);
  }

  // For extension types (e.g., vector), require exact match
  return false;
}

/**
 * Queries all tables in the public schema.
 */
async function queryTables(queryRunner: QueryRunner): Promise<ReadonlyArray<string>> {
  const result = await queryRunner.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

/**
 * Queries columns for a specific table.
 */
async function queryColumns(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<ReadonlyArray<DatabaseColumn>> {
  const result = await queryRunner.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
  );
  return result.rows.map((row) => {
    const databaseType = row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type;
    return {
      name: row.column_name,
      dataType: databaseType,
      isNullable: row.is_nullable === 'YES',
    };
  });
}

/**
 * Queries primary key columns for a specific table.
 */
async function queryPrimaryKeys(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<ReadonlyArray<string>> {
  const result = await queryRunner.query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [tableName],
  );
  return result.rows.map((row) => row.column_name);
}

/**
 * Queries foreign key constraints for a specific table.
 */
async function queryForeignKeys(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<ReadonlyArray<DatabaseForeignKey>> {
  const result = await queryRunner.query<{
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
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [tableName],
  );

  // Group by constraint name
  const fkMap = new Map<string, DatabaseForeignKey>();
  for (const row of result.rows) {
    const existing = fkMap.get(row.constraint_name);
    if (existing) {
      fkMap.set(row.constraint_name, {
        ...existing,
        columns: [...existing.columns, row.column_name],
        referencedColumns: [...existing.referencedColumns, row.foreign_column_name],
      });
    } else {
      fkMap.set(row.constraint_name, {
        columns: [row.column_name],
        referencedTable: row.foreign_table_name,
        referencedColumns: [row.foreign_column_name],
        constraintName: row.constraint_name,
      });
    }
  }

  return Array.from(fkMap.values());
}

/**
 * Queries unique constraints for a specific table.
 */
async function queryUniqueConstraints(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<ReadonlyArray<DatabaseUniqueConstraint>> {
  const result = await queryRunner.query<{
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
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'UNIQUE'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [tableName],
  );

  // Group by constraint name
  const uniqueMap = new Map<string, DatabaseUniqueConstraint>();
  for (const row of result.rows) {
    const existing = uniqueMap.get(row.constraint_name);
    if (existing) {
      uniqueMap.set(row.constraint_name, {
        ...existing,
        columns: [...existing.columns, row.column_name],
      });
    } else {
      uniqueMap.set(row.constraint_name, {
        columns: [row.column_name],
        constraintName: row.constraint_name,
      });
    }
  }

  return Array.from(uniqueMap.values());
}

/**
 * Queries indexes for a specific table.
 */
async function queryIndexes(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<ReadonlyArray<DatabaseIndex>> {
  const result = await queryRunner.query<{
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
     WHERE n.nspname = 'public'
       AND t.relname = $1
       AND NOT ix.indisprimary
     ORDER BY i.relname, array_position(ix.indkey, a.attnum)`,
    [tableName],
  );

  // Group by index name
  const indexMap = new Map<string, DatabaseIndex>();
  for (const row of result.rows) {
    if (!row.column_name) {
      continue;
    }
    const existing = indexMap.get(row.index_name);
    if (existing) {
      indexMap.set(row.index_name, {
        ...existing,
        columns: [...existing.columns, row.column_name],
      });
    } else {
      indexMap.set(row.index_name, {
        name: row.index_name,
        columns: [row.column_name],
        isUnique: row.is_unique,
      });
    }
  }

  return Array.from(indexMap.values());
}

/**
 * Queries installed PostgreSQL extensions.
 */
async function queryExtensions(queryRunner: QueryRunner): Promise<ReadonlyArray<string>> {
  const result = await queryRunner.query<{ extname: string }>(
    'SELECT extname FROM pg_extension ORDER BY extname',
  );
  return result.rows.map((row) => row.extname);
}

/**
 * Loads complete database schema information for a table.
 */
async function loadDatabaseTable(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<DatabaseTable> {
  const [columns, primaryKey, foreignKeys, uniqueConstraints, indexes] = await Promise.all([
    queryColumns(queryRunner, tableName),
    queryPrimaryKeys(queryRunner, tableName),
    queryForeignKeys(queryRunner, tableName),
    queryUniqueConstraints(queryRunner, tableName),
    queryIndexes(queryRunner, tableName),
  ]);

  return {
    name: tableName,
    columns,
    ...(primaryKey.length > 0 ? { primaryKey } : {}),
    foreignKeys,
    uniqueConstraints,
    indexes,
  };
}

/**
 * Compares contract table against database table and collects schema issues.
 */
function compareTable(
  contractTable: StorageTable,
  contractTableName: string,
  dbTable: DatabaseTable | undefined,
  installedExtensions: ReadonlyArray<string>,
): ReadonlyArray<SchemaIssue> {
  const issues: SchemaIssue[] = [];

  // Check if table exists
  if (!dbTable) {
    issues.push({
      kind: 'missing_table',
      table: contractTableName,
      message: `Table ${contractTableName} is not present in database`,
    });
    return issues;
  }

  // Compare columns
  for (const [columnName, contractColumn] of Object.entries(contractTable.columns)) {
    const dbColumn = dbTable.columns.find((c) => c.name === columnName);
    if (!dbColumn) {
      issues.push({
        kind: 'missing_column',
        table: contractTableName,
        column: columnName,
        message: `Column ${contractTableName}.${columnName} is not present in database`,
      });
      continue;
    }

    // Check type compatibility
    if (!isTypeCompatible(contractColumn.type, dbColumn.dataType)) {
      issues.push({
        kind: 'type_mismatch',
        table: contractTableName,
        column: columnName,
        expected: contractColumn.type,
        actual: dbColumn.dataType,
        message: `Column ${contractTableName}.${columnName} type mismatch: expected ${contractColumn.type}, found ${dbColumn.dataType}`,
      });
    }

    // Check nullability
    if (contractColumn.nullable !== dbColumn.isNullable) {
      issues.push({
        kind: 'nullability_mismatch',
        table: contractTableName,
        column: columnName,
        expected: contractColumn.nullable ? 'nullable' : 'not null',
        actual: dbColumn.isNullable ? 'nullable' : 'not null',
        message: `Column ${contractTableName}.${columnName} nullability mismatch: expected ${contractColumn.nullable ? 'nullable' : 'not null'}, found ${dbColumn.isNullable ? 'nullable' : 'not null'}`,
      });
    }

    // Check for extension-backed types
    if (contractColumn.type.includes('/') && !contractColumn.type.startsWith('pg/')) {
      // Extension type (e.g., vector from pgvector)
      const extensionName = contractColumn.type.split('/')[0];
      if (extensionName && !installedExtensions.includes(extensionName)) {
        issues.push({
          kind: 'extension_missing',
          table: contractTableName,
          column: columnName,
          message: `Extension ${extensionName} is required for column ${contractTableName}.${columnName} but is not installed`,
        });
      }
    }
  }

  // Compare primary key
  if (contractTable.primaryKey) {
    const contractPK = [...contractTable.primaryKey.columns].sort().join(',');
    const dbPK = dbTable.primaryKey ? [...dbTable.primaryKey].sort().join(',') : '';
    if (contractPK !== dbPK) {
      issues.push({
        kind: 'primary_key_mismatch',
        table: contractTableName,
        expected: contractPK,
        actual: dbPK || '(none)',
        message: `Primary key mismatch for table ${contractTableName}: expected columns [${contractPK}], found [${dbPK || '(none)'}]`,
      });
    }
  } else if (dbTable.primaryKey && dbTable.primaryKey.length > 0) {
    // Contract doesn't expect PK but database has one - this is OK in permissive mode
    // In strict mode, this would be an issue (future enhancement)
  }

  // Compare foreign keys
  for (const contractFK of contractTable.foreignKeys) {
    const contractFKKey = `${[...contractFK.columns].sort().join(',')}->${contractFK.references.table}.${[...contractFK.references.columns].sort().join(',')}`;
    const matchingFK = dbTable.foreignKeys.find((dbFK) => {
      const dbFKKey = `${[...dbFK.columns].sort().join(',')}->${dbFK.referencedTable}.${[...dbFK.referencedColumns].sort().join(',')}`;
      return contractFKKey === dbFKKey;
    });
    if (!matchingFK) {
      issues.push({
        kind: 'foreign_key_mismatch',
        table: contractTableName,
        indexOrConstraint: contractFK.name ?? '(unnamed)',
        expected: `${contractFK.columns.join(',')} -> ${contractFK.references.table}(${contractFK.references.columns.join(',')})`,
        message: `Foreign key mismatch for table ${contractTableName}: expected ${contractFK.columns.join(',')} -> ${contractFK.references.table}(${contractFK.references.columns.join(',')})`,
      });
    }
  }

  // Compare unique constraints
  for (const contractUnique of contractTable.uniques) {
    const contractUniqueKey = [...contractUnique.columns].sort().join(',');
    const matchingUnique = dbTable.uniqueConstraints.find((dbUnique) => {
      const dbUniqueKey = [...dbUnique.columns].sort().join(',');
      return contractUniqueKey === dbUniqueKey;
    });
    if (!matchingUnique) {
      issues.push({
        kind: 'unique_constraint_mismatch',
        table: contractTableName,
        indexOrConstraint: contractUnique.name ?? '(unnamed)',
        expected: contractUnique.columns.join(','),
        message: `Unique constraint mismatch for table ${contractTableName}: expected columns [${contractUnique.columns.join(',')}]`,
      });
    }
  }

  // Compare indexes
  for (const contractIndex of contractTable.indexes) {
    const contractIndexKey = [...contractIndex.columns].sort().join(',');
    const matchingIndex = dbTable.indexes.find((dbIndex) => {
      const dbIndexKey = [...dbIndex.columns].sort().join(',');
      return contractIndexKey === dbIndexKey;
    });
    if (!matchingIndex) {
      issues.push({
        kind: 'index_mismatch',
        table: contractTableName,
        indexOrConstraint: contractIndex.name ?? '(unnamed)',
        expected: contractIndex.columns.join(','),
        message: `Index mismatch for table ${contractTableName}: expected columns [${contractIndex.columns.join(',')}]`,
      });
    }
  }

  return issues;
}

/**
 * Verifies that the live database schema satisfies the emitted contract.
 * Thin wrapper around core verifyDatabaseSchema action.
 * This is used by `db schema-verify` command.
 */
export async function verifySchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: unknown;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly strict: boolean;
  readonly startTime: number;
  readonly contractPath: string;
  readonly configPath?: string;
}): Promise<{
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: ReadonlyArray<SchemaIssue>;
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}> {
  // Delegate to core verifyDatabaseSchema action
  return verifyDatabaseSchema({
    driver: options.driver,
    contractIR: options.contractIR,
    family: sqlFamilyDescriptor,
    target: options.target,
    adapter: options.adapter,
    extensions: options.extensions,
    strict: options.strict,
    startTime: options.startTime,
    contractPath: options.contractPath,
    ...(options.configPath ? { configPath: options.configPath } : {}),
  });
}
