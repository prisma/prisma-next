import { resolveStorageTable } from '@prisma-next/sql-contract/resolve-storage-table';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

export interface ResolvedTable {
  readonly namespaceId: string;
  readonly table: StorageTable;
}

export function resolveTableForFlatName(
  storage: SqlStorage,
  tableName: string,
): ResolvedTable | undefined {
  const resolved = resolveStorageTable(storage, tableName);
  if (resolved === undefined) {
    return undefined;
  }
  return resolved;
}

export function resolveTableInNamespace(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const namespace = storage.namespaces[namespaceId];
  if (namespace === undefined || !Object.hasOwn(namespace.tables, tableName)) {
    return undefined;
  }
  return namespace.tables[tableName];
}
