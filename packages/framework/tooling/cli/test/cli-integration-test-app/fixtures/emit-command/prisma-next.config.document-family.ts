import { defineConfig } from '@prisma-next/cli/config-types';
import { contract } from './invalid-contract-document';

// Create a config with document family (which doesn't exist, but we'll test the error)
const mockHook = {
  id: 'document',
  validateTypes: () => {},
  validateStructure: () => {},
  generateContractTypes: () => '',
};

export default defineConfig({
  family: {
    kind: 'family',
    familyId: 'document',
    manifest: { id: 'document', version: '0.0.1' },
    hook: mockHook,
    convertOperationManifest: () => ({
      forTypeId: '',
      method: '',
      args: [],
      returns: { kind: 'builtin' as const, type: 'string' as const },
      lowering: {
        targetFamily: 'sql' as const,
        strategy: 'function' as const,
        template: '',
      },
    }),
    validateContractIR: (contract: unknown) => contract,
    create: () => ({} as any), // Mock create method
  },
  target: {
    kind: 'target',
    id: 'mongodb',
    familyId: 'document',
    manifest: { id: 'mongodb', version: '1.0.0' },
  },
  adapter: {
    kind: 'adapter',
    id: 'mongodb',
    familyId: 'document',
    manifest: { id: 'mongodb', version: '1.0.0' },
  },
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
});
