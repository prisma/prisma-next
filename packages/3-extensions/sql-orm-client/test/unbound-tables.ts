import {
  namespaceTables,
  type SqlNamespace,
  type StorageTable,
} from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';

type StorageLike = {
  readonly namespaces: Readonly<Record<string, unknown>>;
};

export function unboundTables(storage: StorageLike): Readonly<Record<string, StorageTable>> {
  const merged: Record<string, StorageTable> = {};
  for (const ns of Object.values(storage.namespaces)) {
    Object.assign(
      merged,
      namespaceTables(
        blindCast<SqlNamespace, 'runtime namespaces hold SqlNamespace concretions'>(ns),
      ),
    );
  }
  return merged;
}
