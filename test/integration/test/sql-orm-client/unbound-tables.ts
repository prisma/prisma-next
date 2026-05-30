import { getStorageNamespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlNamespace, StorageTable } from '@prisma-next/sql-contract/types';

export function unboundTables(storage: object): Readonly<Record<string, StorageTable>> {
  return getStorageNamespace<SqlNamespace>(storage, UNBOUND_NAMESPACE_ID)?.tables ?? {};
}
