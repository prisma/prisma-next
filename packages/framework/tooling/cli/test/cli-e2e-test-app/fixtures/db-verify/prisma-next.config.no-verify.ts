import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/cli';
import type { SqlFamilyContext } from '@prisma-next/family-sql/context';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

// Create family descriptor with stub verify hooks that throw errors
// This tests the error case where verify hooks are not properly implemented
const sqlFamilyWithoutVerify = {
  kind: 'family' as const,
  id: 'sql',
  hook: sqlTargetFamilyHook, // This hook has validateTypes and validateStructure
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
  readMarker: async () => {
    throw new Error('readMarker not implemented');
  },
  prepareControlContext: async () => {
    throw new Error('prepareControlContext not implemented');
  },
  introspectSchema: async () => {
    throw new Error('introspectSchema not implemented');
  },
  verifySchema: async () => {
    throw new Error('verifySchema not implemented');
  },
};

export default defineConfig<SqlFamilyContext>({
  family: sqlFamilyWithoutVerify,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    url: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
