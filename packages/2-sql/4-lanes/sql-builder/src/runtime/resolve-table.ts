import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

export function resolveTableInNamespace(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const namespace = storage.namespaces[namespaceId];
  if (namespace === undefined || !Object.hasOwn(namespace.entries.table, tableName)) {
    return undefined;
  }
  return namespace.entries.table[tableName];
}
