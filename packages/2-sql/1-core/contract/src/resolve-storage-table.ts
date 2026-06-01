import type { SqlNamespace, SqlStorage } from './ir/sql-storage';
import type { StorageTable } from './ir/storage-table';

export interface ResolvedStorageTable {
  readonly namespaceId: string;
  readonly table: StorageTable;
}

export interface ResolveStorageTableOptions {
  readonly defaultNamespaceId: string;
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
 * Resolve a bare storage table name to its namespace coordinate and table IR.
 * Scans the default namespace first, then every other declared namespace.
 */
export function resolveStorageTable(
  storage: SqlStorage,
  tableName: string,
  options: ResolveStorageTableOptions,
): ResolvedStorageTable | undefined {
  const { defaultNamespaceId } = options;
  const namespaces = storage.namespaces;

  const defaultNamespace = namespaces[defaultNamespaceId];
  const defaultTable = tableInNamespace(defaultNamespace, tableName);
  if (defaultTable !== undefined) {
    return { namespaceId: defaultNamespaceId, table: defaultTable };
  }

  for (const namespaceId of Object.keys(namespaces)) {
    if (namespaceId === defaultNamespaceId) {
      continue;
    }
    const table = tableInNamespace(namespaces[namespaceId], tableName);
    if (table !== undefined) {
      return { namespaceId, table };
    }
  }

  return undefined;
}
