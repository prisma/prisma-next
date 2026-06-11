import {
  namespaceTables,
  type SqlStorage,
  type StorageTable,
} from '@prisma-next/sql-contract/types';

export function resolveTableInNamespace(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const namespace = storage.namespaces[namespaceId];
  if (namespace === undefined) return undefined;
  const tables = namespaceTables(namespace);
  if (!Object.hasOwn(tables, tableName)) return undefined;
  return tables[tableName];
}
