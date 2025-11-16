import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { SqlFamilyContext } from '@prisma-next/sql-contract/types';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/targets-postgres/cli';

export default defineConfig<SqlFamilyContext>({
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
