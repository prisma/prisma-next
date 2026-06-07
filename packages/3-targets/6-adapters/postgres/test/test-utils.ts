/**
 * Shared test utilities for PostgreSQL adapter tests.
 *
 * These utilities provide factory functions for creating test contracts,
 * schemas, and other common test fixtures.
 */

import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  SqlStorage,
  type StorageTableInput,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createContract } from '@prisma-next/test-utils';

export function createTestContract(
  overrides: { tables?: Record<string, StorageTableInput>; storageHash?: string } = {},
): Contract<SqlStorage> {
  const unboundNs = buildSqlNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: overrides.tables ?? {} },
  });
  return createContract<SqlStorage>({
    storage: new SqlStorage({
      storageHash: (overrides.storageHash ?? 'sha256:test') as never,
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
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
