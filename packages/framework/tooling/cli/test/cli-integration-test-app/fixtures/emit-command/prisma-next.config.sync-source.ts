import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: () => contract,
    output: '{{OUTPUT_DIR}}/contract.json',
    types: '{{OUTPUT_DIR}}/contract.d.ts',
  },
});
