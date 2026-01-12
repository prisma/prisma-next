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

export function extractEnumsFromContract(contract: SqlContract<SqlStorage>): EnumMap {
  const enums: Record<string, string[]> = {};
  const storage = contract.storage;

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
        // Preserve first-seen definition; mismatches will be caught in verification.
        if (!arraysEqual(existing, values)) {
          enums[enumName] = existing;
        }
      } else {
        enums[enumName] = [...values];
      }
    }
  }

  return Object.fromEntries(
    Object.entries(enums).map(([name, values]) => [name, Object.freeze(values.slice())]),
  );
}
