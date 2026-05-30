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
 */
export function* storageNamespaceEntries(
  storage: Record<string, unknown>,
): Generator<readonly [string, Namespace]> {
  for (const [key, value] of Object.entries(storage)) {
    if (isStoragePlaneReservedKey(key)) continue;
    if (isNamespaceEntry(value)) {
      yield [key, value];
    }
  }
}

export function storageNamespaceValues(storage: Record<string, unknown>): Namespace[] {
  return [...storageNamespaceEntries(storage)].map(([, ns]) => ns);
}

export function getStorageNamespace(
  storage: Record<string, unknown>,
  namespaceId: string,
): Namespace | undefined {
  if (isStoragePlaneReservedKey(namespaceId)) {
    return undefined;
  }
  const value = storage[namespaceId];
  return isNamespaceEntry(value) ? value : undefined;
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
