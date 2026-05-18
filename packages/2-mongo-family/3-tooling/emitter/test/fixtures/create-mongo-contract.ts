import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

export function namespacedMongoStorageFromCollections(
  collections: Record<string, unknown>,
  storageHash = 'sha256:test',
) {
  return {
    storageHash,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, tables: collections },
    },
  } as Contract['storage'];
}

export function normalizeMongoStorageInput(
  storage: Record<string, unknown> | undefined,
): Contract['storage'] {
  if (!storage || typeof storage !== 'object') {
    return namespacedMongoStorageFromCollections({}) as Contract['storage'];
  }
  if ('namespaces' in storage) {
    return storage as Contract['storage'];
  }
  if ('collections' in storage) {
    const sh = (storage.storageHash as string | undefined) ?? 'sha256:test';
    return namespacedMongoStorageFromCollections(
      storage.collections as Record<string, unknown>,
      sh,
    ) as Contract['storage'];
  }
  return {
    storageHash: (storage.storageHash as string | undefined) ?? 'sha256:test',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, tables: {} },
    },
  } as Contract['storage'];
}

export function createMongoContract(overrides: Partial<Contract> = {}): Contract {
  const merged = {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    models: {},
    storage: namespacedMongoStorageFromCollections({}) as Contract['storage'],
    extensionPacks: {},
    capabilities: {},
    meta: {},
    roots: {},
    profileHash: 'sha256:test' as const,
    ...overrides,
  };
  merged.storage = normalizeMongoStorageInput(merged.storage as Record<string, unknown>);
  return merged as Contract;
}
