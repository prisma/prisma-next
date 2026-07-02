import { createEnumAccessor, type EnumAccessor } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import { PG_ENUM_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';
import { blindCast } from '@prisma-next/utils/casts';

interface NativeEnumMember {
  readonly name: string;
  readonly value: string;
}

interface NativeEnumEntry {
  readonly typeName: string;
  readonly members: readonly NativeEnumMember[];
}

/**
 * Matches the generic `SqlStorage['namespaces']` shape: `entries` is an open
 * dictionary (`Record<string, unknown>`) at the family level, since
 * `native_enum` is a Postgres-only entity kind the family type doesn't know
 * about. Rehydrated Postgres contracts always carry `PostgresNativeEnum`
 * instances (`{ typeName, members }`) under this key.
 */
interface PostgresStorageLike {
  readonly namespaces: Readonly<
    Record<
      string,
      {
        readonly entries: Readonly<Record<string, unknown>>;
      }
    >
  >;
}

export function buildNativeEnumsMapForNamespace(
  storage: PostgresStorageLike,
  namespaceId: string,
): Record<string, EnumAccessor> {
  const result: Record<string, EnumAccessor> = {};
  const nativeEnums = blindCast<
    Readonly<Record<string, NativeEnumEntry>> | undefined,
    'entries.native_enum holds PostgresNativeEnum instances ({ typeName, members }) once a Postgres contract has been rehydrated through PostgresContractSerializer'
  >(storage.namespaces[namespaceId]?.entries['native_enum']);
  if (nativeEnums) {
    for (const [name, nativeEnum] of Object.entries(nativeEnums)) {
      result[name] = createEnumAccessor({ codecId: PG_ENUM_CODEC_ID, members: nativeEnum.members });
    }
  }
  return result;
}

export function buildNamespacedNativeEnums(
  storage: PostgresStorageLike,
): Record<string, Record<string, EnumAccessor>> {
  const result: Record<string, Record<string, EnumAccessor>> = {};
  for (const namespaceId of Object.keys(storage.namespaces)) {
    result[namespaceId] = buildNativeEnumsMapForNamespace(storage, namespaceId);
  }
  return result;
}

/**
 * Runtime accessor type for `db.native_enums`. Deliberately non-literal (an
 * open `Record<string, EnumAccessor>` per namespace) rather than a per-name
 * literal facade like `NamespacedEnums`: native enums live in the storage
 * plane, which the emitted `.d.ts` does not carry per-entity literal types
 * for. This shape is runtime-correct for both no-emit (TS-authored) and
 * emitted contracts.
 */
export type NamespacedNativeEnums<TContract extends Contract> = {
  readonly [Ns in keyof TContract['storage']['namespaces']]: Readonly<Record<string, EnumAccessor>>;
};
