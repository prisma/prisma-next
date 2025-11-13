import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/cli';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import postgres from '@prisma-next/targets-postgres/cli';
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
    id: 'document',
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
  },
  target: {
    kind: 'target',
    id: 'mongodb',
    family: 'document',
    manifest: { id: 'mongodb', version: '1.0.0' },
  },
  adapter: {
    kind: 'adapter',
    id: 'mongodb',
    family: 'document',
    manifest: { id: 'mongodb', version: '1.0.0' },
  },
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
});
