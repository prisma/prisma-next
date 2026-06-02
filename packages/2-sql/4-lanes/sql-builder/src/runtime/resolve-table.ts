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
