import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/cli';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './contract';

// Create family descriptor without verify.readMarker
// The hook property must be the actual TargetFamilyHook with validateTypes/validateStructure
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
  // verify property is missing - this is what we're testing
};

export default defineConfig({
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
