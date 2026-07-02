import {
  createEnumAccessor,
  type EnumAccessor,
  type EnumEntriesToAccessors,
} from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';
import { isPostgresSchema } from '@prisma-next/target-postgres/types';

export function buildNativeEnumsMapForNamespace(
  storage: SqlStorage,
  namespaceId: string,
): Record<string, EnumAccessor> {
  const result: Record<string, EnumAccessor> = {};
  const ns = storage.namespaces[namespaceId];
  const nativeEnums = isPostgresSchema(ns) ? ns.nativeEnum : {};
  for (const [name, nativeEnum] of Object.entries(nativeEnums)) {
    result[name] = createEnumAccessor({ codecId: PG_ENUM_CODEC_ID, members: nativeEnum.members });
  }
  return result;
}

export function buildNamespacedNativeEnums(
  storage: SqlStorage,
): Record<string, Record<string, EnumAccessor>> {
  const result: Record<string, Record<string, EnumAccessor>> = {};
  for (const namespaceId of Object.keys(storage.namespaces)) {
    result[namespaceId] = buildNativeEnumsMapForNamespace(storage, namespaceId);
  }
  return result;
}

type Present<T> = Exclude<T, undefined>;

type NamespaceNativeEnumEntries<TNs> = TNs extends {
  readonly entries: { readonly native_enum?: infer E };
}
  ? unknown extends E
    ? Record<never, never>
    : Present<E>
  : Record<never, never>;

/**
 * Accessor type for `db.nativeEnums`. Literal for emitted contracts — the emitter type-emits the
 * `native_enum` entries slot, so each accessor carries literal `values`/`names`/`members`. For a
 * no-emit (`typeof contract`) contract the storage type is non-literal and this degrades to the
 * structural shape — the same emit/no-emit boundary column typing has (TML-2960).
 */
export type NamespacedNativeEnums<TContract extends Contract> = {
  readonly [Ns in keyof TContract['storage']['namespaces']]: EnumEntriesToAccessors<
    NamespaceNativeEnumEntries<TContract['storage']['namespaces'][Ns]>
  >;
};
