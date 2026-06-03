import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

type StorageLike = {
  readonly namespaces: Readonly<
    Record<string, { readonly entries?: { readonly table?: Readonly<Record<string, unknown>> } }>
  >;
};

export function unboundTables(
  storage: StorageLike | SqlStorage,
): Readonly<Record<string, StorageTable>> {
  const merged: Record<string, StorageTable> = {};
  for (const ns of Object.values(storage.namespaces)) {
    const table = ns.entries?.table;
    if (table) {
      Object.assign(merged, table);
    }
  }
  return merged;
}
