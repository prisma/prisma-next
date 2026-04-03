import type { Contract } from '@prisma-next/contract/types';

export function createMongoIR(overrides: Partial<Contract> = {}): Contract {
  return {
    targetFamily: 'mongo',
    target: 'mongo',
    models: {},
    storage: { storageHash: 'sha256:test', collections: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    roots: {},
    profileHash: 'sha256:test',
    ...overrides,
  };
}
