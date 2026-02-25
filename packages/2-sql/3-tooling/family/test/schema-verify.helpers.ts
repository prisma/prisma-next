/**
 * Shared test helpers for schema verification tests.
 */
import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ColumnDefault } from '@prisma-next/contract/types';
import {
  applyFkDefaults,
  type SqlContract,
  type SqlStorage,
  type StorageTable,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { CodecControlHooks, ExpandNativeTypeInput } from '../src/core/migrations/types';

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
  storageTypes?: SqlStorage['types'],
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test',
    storage: { tables, ...ifDefined('types', storageTypes) },
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
): SqlSchemaIR {
  return { tables, extensions };
}

/**
 * Creates a minimal contract table for testing.
 */
export function createContractTable(
  columns: Record<
    string,
    { nativeType: string; codecId?: string; nullable: boolean; default?: ColumnDefault }
  >,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      columns: readonly string[];
      references: { table: string; columns: readonly string[] };
      name?: string;
      constraint?: boolean;
      index?: boolean;
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
          ...ifDefined('default', col.default),
        },
      ]),
    ),
    foreignKeys: (options?.foreignKeys ?? []).map((fk) => ({
      ...fk,
      ...applyFkDefaults(fk),
    })),
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
 * Note: default is now a raw string (e.g., "now()", "'hello'::text") matching SqlColumnIR.
 */
export function createSchemaTable(
  name: string,
  columns: Record<string, { nativeType: string; nullable: boolean; default?: string }>,
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
        {
          name: colName,
          nativeType: col.nativeType,
          nullable: col.nullable,
          ...ifDefined('default', col.default),
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
 * Mock implementation of expandNativeType for Postgres parameterized types.
 *
 * IMPORTANT: This mirrors the real implementation in
 * `@prisma-next/adapter-postgres/src/core/parameterized-types.ts` (`expandParameterizedNativeType`).
 * If a new parameterized codec type is added there, this mock must be updated to match.
 *
 * We cannot import the real function because this package (family-sql, Layer 3 Tooling)
 * must not depend on the postgres adapter (Layer 6 Adapters).
 */
function mockExpandParameterizedNativeType(input: ExpandNativeTypeInput): string {
  const { nativeType, codecId, typeParams } = input;

  if (!typeParams || !codecId) {
    return nativeType;
  }

  const isValidNumber = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;

  // Length-parameterized types: char, varchar, bit, varbit
  const lengthCodecs = new Set([
    'sql/char@1',
    'sql/varchar@1',
    'pg/char@1',
    'pg/varchar@1',
    'pg/bit@1',
    'pg/varbit@1',
  ]);
  if (lengthCodecs.has(codecId)) {
    const length = typeParams['length'];
    if (isValidNumber(length)) {
      return `${nativeType}(${length})`;
    }
    return nativeType;
  }

  // Numeric with precision and optional scale
  if (codecId === 'pg/numeric@1') {
    const precision = typeParams['precision'];
    const scale = typeParams['scale'];

    if (isValidNumber(precision)) {
      if (isValidNumber(scale)) {
        return `${nativeType}(${precision},${scale})`;
      }
      return `${nativeType}(${precision})`;
    }
    return nativeType;
  }

  // Temporal types with precision
  const temporalCodecs = new Set([
    'pg/timestamp@1',
    'pg/timestamptz@1',
    'pg/time@1',
    'pg/timetz@1',
    'pg/interval@1',
  ]);
  if (temporalCodecs.has(codecId)) {
    const precision = typeParams['precision'];
    if (isValidNumber(precision)) {
      return `${nativeType}(${precision})`;
    }
    return nativeType;
  }

  return nativeType;
}

/**
 * Creates a mock framework component with expandNativeType hook for Postgres parameterized types.
 * Use this in tests that need to verify parameterized type expansion behavior.
 */
export function createMockPostgresComponent(): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  // Create hooks for each parameterized codec type
  const parameterizedCodecIds = [
    'sql/char@1',
    'sql/varchar@1',
    'pg/char@1',
    'pg/varchar@1',
    'pg/bit@1',
    'pg/varbit@1',
    'pg/numeric@1',
    'pg/timestamp@1',
    'pg/timestamptz@1',
    'pg/time@1',
    'pg/timetz@1',
    'pg/interval@1',
  ];

  const controlHooks: Record<string, CodecControlHooks> = {};
  for (const codecId of parameterizedCodecIds) {
    controlHooks[codecId] = {
      expandNativeType: mockExpandParameterizedNativeType,
    };
  }

  return {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'postgres-mock',
    version: '1.0.0',
    types: {
      codecTypes: {
        controlPlaneHooks: controlHooks,
      },
    },
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}
