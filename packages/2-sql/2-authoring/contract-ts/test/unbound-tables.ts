import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

export type StorageLike = {
  readonly namespaces: Readonly<
    Record<string, { readonly entries?: { readonly table?: Readonly<Record<string, unknown>> } }>
  >;
};

export function unboundTables(
  storage: StorageLike | SqlStorage,
): Readonly<Record<string, StorageTable>> {
  const unbound = storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries?.table;
  if (unbound !== undefined && Object.keys(unbound).length > 0) {
    return unbound as Readonly<Record<string, StorageTable>>;
  }
  return (storage.namespaces['public']?.entries?.table ?? {}) as Readonly<
    Record<string, StorageTable>
  >;
}
