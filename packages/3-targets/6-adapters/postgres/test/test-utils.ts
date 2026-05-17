/**
 * Shared test utilities for PostgreSQL adapter tests.
 *
 * These utilities provide factory functions for creating test contracts,
 * schemas, and other common test fixtures.
 */

import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  SqlStorage,
  type SqlStorageTypeEntry,
  type StorageTable,
  type StorageTableInput,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

export function createTestContract(
  storage: {
    readonly storageHash?: SqlStorage['storageHash'];
    readonly tables?: Record<string, StorageTable | StorageTableInput>;
    readonly types?: Record<string, SqlStorageTypeEntry>;
  } = {},
): Contract<SqlStorage> {
  const { storageHash, tables: flatTables, types: flatTypes } = storage;
  const nestedTables: Record<string, Record<string, StorageTable | StorageTableInput>> = {};
  if (flatTables !== undefined) {
    for (const [name, t] of Object.entries(flatTables)) {
      const ns = t.namespaceId;
      if (nestedTables[ns] === undefined) nestedTables[ns] = {};
      nestedTables[ns][name] = t;
    }
  }
  const nestedTypes = flatTypes === undefined ? {} : { [UNBOUND_NAMESPACE_ID]: flatTypes };
  return createContract<SqlStorage>({
    storage: new SqlStorage({
      tables: nestedTables,
      types: nestedTypes,
      storageHash: storageHash ?? ('sha256:test' as SqlStorage['storageHash']),
    }),
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
    return { tables: {} };
  }

  return {
    tables: {},
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
    kind: 'codec-instance',
    codecId: 'pg/enum@1',
    nativeType,
    typeParams: { values },
  };
}

/** PostgreSQL enum codec identifier */
export const ENUM_CODEC_ID = 'pg/enum@1';
