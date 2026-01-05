/**
 * Shared test helpers for schema verification tests.
 */
import type {
  SqlContract,
  SqlStorage,
  StorageEnum,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type {
  SqlColumnIR,
  SqlEnumIR,
  SqlSchemaIR,
  SqlTableIR,
} from '@prisma-next/sql-schema-ir/types';

/**
 * Empty type metadata registry for tests that don't need codec warnings.
 */
export const emptyTypeMetadataRegistry = new Map<string, { nativeType?: string }>();

/**
 * Creates a minimal valid SqlContract for testing.
 */
export function createTestContract(
  tables: Record<string, StorageTable>,
  extensionPacks: Record<string, unknown> = {},
  enums: Record<string, StorageEnum> = {},
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    storage: { tables, enums },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
    extensionPacks,
  } as SqlContract<SqlStorage>;
}

/**
 * Creates a minimal valid SqlSchemaIR for testing.
 */
export function createTestSchemaIR(
  tables: Record<string, SqlTableIR>,
  extensions: readonly string[] = [],
  enums: Record<string, SqlEnumIR> = {},
): SqlSchemaIR {
  return { tables, extensions, enums };
}

/**
 * Creates a minimal contract table for testing.
 */
export function createContractTable(
  columns: Record<string, { nativeType: string; codecId?: string; nullable: boolean }>,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      columns: readonly string[];
      references: { table: string; columns: readonly string[] };
      name?: string;
    }>;
    uniques?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
    indexes?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
  },
): StorageTable {
  const result: StorageTable = {
    columns: Object.fromEntries(
      Object.entries(columns).map(([name, col]) => [
        name,
        {
          nativeType: col.nativeType,
          codecId: col.codecId ?? `pg/${col.nativeType}@1`,
          nullable: col.nullable,
        },
      ]),
    ),
    foreignKeys: options?.foreignKeys ?? [],
    uniques: options?.uniques ?? [],
    indexes: options?.indexes ?? [],
  };
  if (options?.primaryKey) {
    return { ...result, primaryKey: options.primaryKey };
  }
  return result;
}

/**
 * Creates a minimal schema table for testing.
 */
export function createSchemaTable(
  name: string,
  columns: Record<string, { nativeType: string; nullable: boolean }>,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      columns: readonly string[];
      referencedTable: string;
      referencedColumns: readonly string[];
      name?: string;
    }>;
    uniques?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
    indexes?: ReadonlyArray<{ columns: readonly string[]; unique: boolean; name?: string }>;
  },
): SqlTableIR {
  const result: SqlTableIR = {
    name,
    columns: Object.fromEntries(
      Object.entries(columns).map(([colName, col]) => [
        colName,
        { name: colName, nativeType: col.nativeType, nullable: col.nullable } as SqlColumnIR,
      ]),
    ),
    foreignKeys: options?.foreignKeys ?? [],
    uniques: options?.uniques ?? [],
    indexes: options?.indexes ?? [],
  };
  if (options?.primaryKey) {
    return { ...result, primaryKey: options.primaryKey };
  }
  return result;
}
