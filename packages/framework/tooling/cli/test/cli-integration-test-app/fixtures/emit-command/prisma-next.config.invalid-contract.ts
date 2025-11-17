import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './invalid-contract';

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
});
