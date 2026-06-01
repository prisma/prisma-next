import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';

const POSTGRES_DEFAULT_NAMESPACE_ID = 'public' as const;

type StorageLike = {
  readonly namespaces: Readonly<
    Record<string, { readonly tables?: Readonly<Record<string, unknown>> }>
  >;
};

export function unboundTables(
  storage: StorageLike | SqlStorage,
): Readonly<Record<string, StorageTable>> {
  return (storage.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID]?.tables ?? {}) as Readonly<
    Record<string, StorageTable>
  >;
}
