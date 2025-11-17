import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: async () => {
      const { contract } = await import('./contract');
      return contract;
    },
    output: '{{OUTPUT_DIR}}/contract.json',
    types: '{{OUTPUT_DIR}}/contract.d.ts',
  },
});
