import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './contract';

// This config uses postgres target but we'll manually modify the emitted contract
// to have mysql target to test target mismatch
export default defineConfig({
  family: sql,
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
    url: '{{DB_URL}}',
  },
});
