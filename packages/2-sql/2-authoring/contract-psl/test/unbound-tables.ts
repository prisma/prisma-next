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
  const unbound = storage.namespaces[UNBOUND_NAMESPACE_ID]?.tables;
  if (unbound !== undefined && Object.keys(unbound).length > 0) {
    return unbound as Readonly<Record<string, StorageTable>>;
  }
  return (storage.namespaces['public']?.tables ?? {}) as Readonly<Record<string, StorageTable>>;
}
