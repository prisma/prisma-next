import type { StorageColumn, StorageTypeInstance } from '@prisma-next/sql-contract/types';

export type ResolvedColumnTypeMetadata = Pick<
  StorageColumn,
  'nativeType' | 'codecId' | 'typeParams'
>;

export function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }

  if (!Object.hasOwn(storageTypes, column.typeRef)) {
    return column;
  }
  const referencedType = storageTypes[column.typeRef];

  return {
    codecId: referencedType.codecId,
    nativeType: referencedType.nativeType,
    typeParams: referencedType.typeParams,
  };
}
