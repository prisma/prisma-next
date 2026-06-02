import type { SqlNamespace, SqlStorage } from './ir/sql-storage';
import type { StorageTable } from './ir/storage-table';

export interface ResolvedStorageTable {
  readonly namespaceId: string;
  readonly table: StorageTable;
}

function tableInNamespace(
  namespace: SqlNamespace | undefined,
  tableName: string,
): StorageTable | undefined {
  if (namespace === undefined) {
    return undefined;
  }
  const tables = namespace.tables;
  if (!Object.hasOwn(tables, tableName)) {
    return undefined;
  }
  return tables[tableName];
}

/**
 * Resolve a bare storage table name to its namespace coordinate and table IR by
 * scanning the contract's namespaces. For the single-namespace contracts in
 * scope the scan is exact; cross-namespace bare-name collisions are selected
 * explicitly (TML-2550).
 */
export function resolveStorageTable(
  storage: SqlStorage,
  tableName: string,
): ResolvedStorageTable | undefined {
  for (const namespaceId of Object.keys(storage.namespaces)) {
    const table = tableInNamespace(storage.namespaces[namespaceId], tableName);
    if (table !== undefined) {
      return { namespaceId, table };
    }
  }

  return undefined;
}
