import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

// This config uses postgres target but we'll manually modify the emitted contract
// to have mysql target to test target mismatch
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    url: '{{DB_URL}}',
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
