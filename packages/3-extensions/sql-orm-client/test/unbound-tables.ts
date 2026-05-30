import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

type StorageLike = {
  readonly namespaces: Readonly<
    Record<string, { readonly tables?: Readonly<Record<string, unknown>> }>
  >;
};

export function unboundTables(
  storage: StorageLike | SqlStorage,
): Readonly<Record<string, StorageTable>> {
  return (getStorageNamespace(storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID)?.tables ??
    {}) as Readonly<Record<string, StorageTable>>;
}
