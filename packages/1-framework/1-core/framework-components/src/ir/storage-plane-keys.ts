import type { StorageHashBase } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { Namespace } from './namespace';

/**
 * Own-enumerable keys under a storage plane object that are not namespace
 * entries. Walkers (`elementCoordinates`, validators, serializers) skip these.
 */
export const STORAGE_PLANE_RESERVED_KEYS = ['storageHash', 'types'] as const;

export type StoragePlaneReservedKey = (typeof STORAGE_PLANE_RESERVED_KEYS)[number];

export function isStoragePlaneReservedKey(key: string): key is StoragePlaneReservedKey {
  return (STORAGE_PLANE_RESERVED_KEYS as readonly string[]).includes(key);
}

function isNamespaceEntry(value: unknown): value is Namespace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'string'
  );
}

/**
 * Enumerate namespace-id → namespace pairs on a storage-shaped value.
 * Skips {@link STORAGE_PLANE_RESERVED_KEYS} and non-namespace entries.
 *
 * Accepts `object` so both the family storage class instances
 * (`SqlStorage` / `MongoStorage`, whose namespace ids are own-enumerable
 * keys) and plain validated JSON records flow in without a cast.
 */
export function* storageNamespaceEntries<T extends Namespace = Namespace>(
  storage: object,
): Generator<readonly [string, T]> {
  for (const [key, value] of Object.entries(storage)) {
    if (isStoragePlaneReservedKey(key)) continue;
    if (isNamespaceEntry(value)) {
      yield [
        key,
        blindCast<T, 'caller selects the family namespace concretion via the type parameter'>(
          value,
        ),
      ];
    }
  }
}

export function storageNamespaceValues<T extends Namespace = Namespace>(storage: object): T[] {
  return [...storageNamespaceEntries<T>(storage)].map(([, ns]) => ns);
}

/**
 * Look up one namespace entry by id, skipping reserved keys. The type
 * parameter lets callers select the family namespace concretion
 * (`SqlNamespace` / `MongoNamespace`) they know the storage carries;
 * it defaults to the framework `Namespace`.
 */
export function getStorageNamespace<T extends Namespace = Namespace>(
  storage: object,
  namespaceId: string,
): T | undefined {
  if (isStoragePlaneReservedKey(namespaceId)) {
    return undefined;
  }
  const value = (storage as Record<string, unknown>)[namespaceId];
  return isNamespaceEntry(value)
    ? blindCast<T, 'caller selects the family namespace concretion via the type parameter'>(value)
    : undefined;
}

export type FlatStorageInput<TNamespace> = {
  readonly storageHash: StorageHashBase<string>;
  readonly types?: Readonly<Record<string, unknown>>;
} & Readonly<Record<string, TNamespace>>;

/**
 * Spread a namespace map into flat storage input (namespace ids as direct keys).
 */
export function flatStorageInput<TNamespace>(params: {
  readonly storageHash: StorageHashBase<string>;
  readonly types?: Readonly<Record<string, unknown>>;
  readonly namespaces: Readonly<Record<string, TNamespace>>;
}): FlatStorageInput<TNamespace> {
  const result = blindCast<
    FlatStorageInput<TNamespace>,
    'namespace map spread merges dynamic keys onto storageHash base'
  >({
    storageHash: params.storageHash,
    ...params.namespaces,
  });
  if (params.types !== undefined) {
    Object.assign(result, { types: params.types });
  }
  return result;
}
