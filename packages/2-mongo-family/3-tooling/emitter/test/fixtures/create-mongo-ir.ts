import type { ContractIR } from '@prisma-next/contract/ir';

export function createMongoIR(overrides: Partial<ContractIR> = {}): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'mongo',
    target: 'mongo',
    models: {},
    relations: {},
    storage: { collections: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}
