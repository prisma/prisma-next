import {
  namespaceTables,
  type SqlStorage,
  type StorageTable,
} from '@prisma-next/sql-contract/types';

export function unboundTables(storage: SqlStorage): Readonly<Record<string, StorageTable>> {
  const merged: Record<string, StorageTable> = {};
  for (const ns of Object.values(storage.namespaces)) {
    Object.assign(merged, namespaceTables(ns));
  }
  return merged;
}
