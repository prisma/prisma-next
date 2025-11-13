import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

// Create family descriptor without verify.readMarkerSql
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
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    url: '{{DB_URL}}', // Placeholder to be replaced in tests
    queryRunnerFactory: async (url) => {
      // @ts-expect-error - pg types are not available in test fixtures
      const pg = await import('pg');
      const { Client } = pg;
      const client = new Client({ connectionString: url });
      await client.connect();
      return {
        query: async (sql, params) => {
          const result = await client.query(sql, params);
          return { rows: result.rows };
        },
        close: async () => {
          await client.end();
        },
      };
    },
  },
});
