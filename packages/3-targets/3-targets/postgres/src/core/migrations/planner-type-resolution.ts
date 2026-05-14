import {
  SqlEnumType,
  type StorageColumn,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';

export type ResolvedColumnTypeMetadata = Pick<
  StorageColumn,
  'nativeType' | 'codecId' | 'typeParams'
>;

export function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance | SqlEnumType>>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }

  const referencedType = storageTypes[column.typeRef];
  if (!referencedType) {
    return column;
  }

  if (referencedType instanceof SqlEnumType) {
    // Enum types are referenced by name (`quoteIdentifier(nativeType)`),
    // not via parameterised codec expansion. The codec binding still
    // matters for codec-driven runtime concerns (identity-value
    // resolution, etc.), but `typeParams` is intentionally omitted here
    // so `expandParameterizedTypeSql` does not try to look up a
    // (deliberately absent) `expandNativeType` hook for `pg/enum@*`.
    return {
      codecId: referencedType.codecBinding.codecId,
      nativeType: referencedType.nativeType,
    };
  }

  return {
    codecId: referencedType.codecId,
    nativeType: referencedType.nativeType,
    typeParams: referencedType.typeParams,
  };
}
