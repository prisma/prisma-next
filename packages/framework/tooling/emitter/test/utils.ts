import type { ContractIR } from '../src/types';

/**
 * Factory function for creating ContractIR objects in tests.
 * Provides sensible defaults and allows overriding specific fields.
 */
export function createContractIR(overrides: Partial<ContractIR> = {}): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensions: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}
