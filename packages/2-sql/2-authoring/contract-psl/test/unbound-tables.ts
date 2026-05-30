import { getStorageNamespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlNamespace, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

type StorageLike = Readonly<
  Record<string, { readonly tables?: Readonly<Record<string, unknown>> }>
>;

export function unboundTables(
  storage: StorageLike | SqlStorage,
): Readonly<Record<string, StorageTable>> {
  return ((
    getStorageNamespace(
      storage as unknown as unknown as Record<string, unknown>,
      UNBOUND_NAMESPACE_ID,
    ) as SqlNamespace | undefined
  )?.tables ?? {}) as Readonly<Record<string, StorageTable>>;
}
