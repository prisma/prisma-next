import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

export function namespacedMongoStorageFromCollections(
  collections: Record<string, unknown>,
  storageHash = 'sha256:test',
) {
  return {
    storageHash,
    [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, collections },
  } as Contract['storage'];
}

export function createMongoContract(overrides: Partial<Contract> = {}): Contract {
  return {
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
  } as Contract;
}
