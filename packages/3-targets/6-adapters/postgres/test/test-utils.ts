/**
 * Shared test utilities for PostgreSQL adapter tests.
 *
 * These utilities provide factory functions for creating test contracts,
 * schemas, and other common test fixtures.
 */

import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

/**
 * Creates a minimal SqlContract for testing purposes.
 *
 * @param storage - Partial storage object to merge with defaults
 * @returns A valid SqlContract with all required fields
 */
export function createTestContract(storage: Partial<SqlStorage> = {}): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:test'),
    storage: {
      tables: {},
      types: {},
      ...storage,
    } as SqlStorage,
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

/**
 * Creates a minimal SqlSchemaIR for testing purposes.
 *
 * @param storageTypes - Optional storage types to include in schema annotations
 * @returns A valid SqlSchemaIR representing the database state
 */
export function createTestSchema(storageTypes?: Record<string, StorageTypeInstance>): SqlSchemaIR {
  if (!storageTypes) {
    return { tables: {}, extensions: [] };
  }

  return {
    tables: {},
    extensions: [],
    annotations: {
      pg: {
        storageTypes,
      },
    },
  };
}

/**
 * Creates a test storage type instance for PostgreSQL enums.
 *
 * @param nativeType - PostgreSQL type name (e.g., 'role')
 * @param values - Enum values
 * @returns A StorageTypeInstance for a pg/enum@1 codec
 */
export function createTestEnumType(
  nativeType: string,
  values: readonly string[],
): StorageTypeInstance {
  return {
    codecId: 'pg/enum@1',
    nativeType,
    typeParams: { values },
  };
}

/** PostgreSQL enum codec identifier */
export const ENUM_CODEC_ID = 'pg/enum@1';
