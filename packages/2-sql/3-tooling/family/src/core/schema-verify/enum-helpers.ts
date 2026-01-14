import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { arraysEqual } from './verify-helpers';

export type EnumMap = Record<string, readonly string[]>;

export function resolveColumnTypeParams(
  column: StorageColumn,
  storage: SqlStorage,
): Record<string, unknown> | undefined {
  if (column.typeParams) {
    return column.typeParams;
  }
  if (column.typeRef && storage.types) {
    const ref = storage.types[column.typeRef] as StorageTypeInstance | undefined;
    return ref?.typeParams;
  }
  return undefined;
}

/**
 * Extracts enum definitions from a contract.
 *
 * Enums can be defined in two places:
 * 1. Named type instances in `storage.types` with `pg/enum@1` codecId and `typeParams.values`
 * 2. Inline column definitions with `typeParams.values`
 *
 * Named types in `storage.types` take precedence over inline column definitions.
 */
export function extractEnumsFromContract(contract: SqlContract<SqlStorage>): EnumMap {
  const enums: Record<string, string[]> = {};
  const storage = contract.storage;

  // First, check named type instances in storage.types for enum types
  if (storage.types) {
    for (const [typeName, typeInstance] of Object.entries(storage.types)) {
      // Check if this is an enum type (has typeParams.values array)
      const values = typeInstance.typeParams?.['values'];
      if (Array.isArray(values) && values.every((v) => typeof v === 'string')) {
        enums[typeName] = [...values];
      }
    }
  }

  // Then, extract enums from column inline definitions
  // Named types take precedence, so we only add column-derived enums if they don't already exist
  for (const table of Object.values(storage.tables)) {
    for (const column of Object.values(table.columns)) {
      const typeParams = resolveColumnTypeParams(column, storage);
      const values = typeParams?.['values'];

      if (!Array.isArray(values) || values.some((v) => typeof v !== 'string')) {
        continue;
      }

      const enumName = column.nativeType;
      const existing = enums[enumName];
      if (existing) {
        // Preserve first-seen definition (named type takes precedence);
        // mismatches will be caught in verification.
        if (!arraysEqual(existing, values)) {
          enums[enumName] = existing;
        }
      } else {
        // No named type found, use column-derived definition
        enums[enumName] = [...values];
      }
    }
  }

  return Object.fromEntries(
    Object.entries(enums).map(([name, values]) => [name, Object.freeze(values.slice())]),
  );
}
