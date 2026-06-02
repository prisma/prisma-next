import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

type StorageLike = {
  readonly namespaces: Readonly<
    Record<string, { readonly tables?: Readonly<Record<string, unknown>> }>
  >;
};

export function unboundTables(
  storage: StorageLike | SqlStorage,
): Readonly<Record<string, StorageTable>> {
  const merged: Record<string, StorageTable> = {};
  for (const ns of Object.values(storage.namespaces)) {
    if (ns.tables) {
      Object.assign(merged, ns.tables);
    }
  }
  return merged;
}
