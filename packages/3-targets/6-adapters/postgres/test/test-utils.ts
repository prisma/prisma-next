/**
 * Shared test utilities for PostgreSQL adapter tests.
 *
 * These utilities provide factory functions for creating test contracts,
 * schemas, and other common test fixtures.
 */

import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

export function createTestContract(storage: Partial<SqlStorage> = {}): Contract<SqlStorage> {
  return createContract<SqlStorage>({
    storage: { tables: {}, types: {}, ...storage },
  });
}

/**
 * Creates a minimal SqlSchemaIR for testing purposes.
 *
 * @param storageTypes - Optional storage types to include in schema annotations
 * @returns A valid SqlSchemaIR representing the database state
 */
export function createTestSchema(storageTypes?: Record<string, StorageTypeInstance>): SqlSchemaIR {
  if (!storageTypes) {
    return { tables: {}, dependencies: [] };
  }

  return {
    tables: {},
    dependencies: [],
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
