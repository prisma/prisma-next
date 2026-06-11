import { namespaceTables, type SqlNamespace, type SqlStorage } from './ir/sql-storage';
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
  const tables = namespaceTables(namespace);
  if (!Object.hasOwn(tables, tableName)) {
    return undefined;
  }
  return tables[tableName];
}

/**
 * Resolve a bare storage table name to its namespace coordinate and table IR.
 *
 * When `namespaceId` is supplied, the table is resolved strictly within that
 * namespace (no scan). When omitted, a bare name unique across namespaces
 * resolves to its sole namespace; a bare name declared in more than one
 * namespace throws a fail-fast diagnostic naming the candidate namespaces
 * rather than silently selecting the first match.
 */
export function resolveStorageTable(
  storage: SqlStorage,
  tableName: string,
  namespaceId?: string,
): ResolvedStorageTable | undefined {
  if (namespaceId !== undefined) {
    const table = tableInNamespace(storage.namespaces[namespaceId], tableName);
    return table === undefined ? undefined : { namespaceId, table };
  }

  const matches: ResolvedStorageTable[] = [];
  for (const candidateNamespaceId of Object.keys(storage.namespaces)) {
    const table = tableInNamespace(storage.namespaces[candidateNamespaceId], tableName);
    if (table !== undefined) {
      matches.push({ namespaceId: candidateNamespaceId, table });
    }
  }

  if (matches.length > 1) {
    const candidates = matches
      .map((match) => match.namespaceId)
      .sort()
      .join(', ');
    throw new Error(
      `Storage table "${tableName}" is ambiguous across namespaces [${candidates}]; qualify it with a namespace coordinate.`,
    );
  }

  return matches[0];
}
