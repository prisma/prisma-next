import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  namespaceTables,
  type SqlStorage,
  type StorageTable,
} from '@prisma-next/sql-contract/types';

export function unboundTables(storage: SqlStorage): Readonly<Record<string, StorageTable>> {
  const unboundNs = storage.namespaces[UNBOUND_NAMESPACE_ID];
  const unbound = unboundNs !== undefined ? namespaceTables(unboundNs) : undefined;
  if (unbound !== undefined && Object.keys(unbound).length > 0) {
    return unbound;
  }
  const publicNs = storage.namespaces['public'];
  return publicNs !== undefined ? namespaceTables(publicNs) : {};
}
