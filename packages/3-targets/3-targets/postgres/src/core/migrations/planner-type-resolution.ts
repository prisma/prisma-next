import {
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
  type StorageColumn,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';

export type ResolvedColumnTypeMetadata = Pick<
  StorageColumn,
  'nativeType' | 'codecId' | 'typeParams'
>;

export function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }

  const referencedType = storageTypes[column.typeRef];
  if (!referencedType) {
    return column;
  }

  if (isPostgresEnumStorageEntry(referencedType)) {
    // Enum types are referenced by name (`quoteIdentifier(nativeType)`),
    // not via parameterised codec expansion. The structural shape
    // carries `codecId` as an enumerable property (mirroring the
    // codec-typed view); `typeParams` is intentionally omitted here so
    // `expandParameterizedTypeSql` does not try to look up a
    // (deliberately absent) `expandNativeType` hook for `pg/enum@*`.
    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
    };
  }

  return {
    codecId: referencedType.codecId,
    nativeType: referencedType.nativeType,
    ...ifDefined('typeParams', referencedType.typeParams),
  };
}
