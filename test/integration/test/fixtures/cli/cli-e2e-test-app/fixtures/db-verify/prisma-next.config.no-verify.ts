import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { ControlFamilyDescriptor } from '@prisma-next/core-control-plane/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

// Create family descriptor without create method
// This tests validation that requires create method
const sqlFamilyWithoutCreate = {
  kind: 'family' as const,
  familyId: 'sql' as const,
  manifest: { id: 'sql', version: '0.0.1' },
  hook: sqlTargetFamilyHook,
  // create method is missing - this is what we're testing
};

export default defineConfig({
  // Test fixture - intentionally missing create method to test validation
  family: sqlFamilyWithoutCreate as unknown as ControlFamilyDescriptor<'sql'>,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: {
    source: async () => ({ ok: true, value: contract }),
    output: 'output/contract.json',
  },
  db: {
    connection: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
