import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/cli';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './contract';

// Create family descriptor without create method
// This tests validation that requires create method
const sqlFamilyWithoutCreate = {
  kind: 'family' as const,
  familyId: 'sql' as const,
  manifest: { id: 'sql', version: '0.0.1' },
  hook: sqlTargetFamilyHook,
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
  // create method is missing - this is what we're testing
};

export default defineConfig({
  family: sqlFamilyWithoutCreate as any, // Type assertion to bypass validation for this test
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
