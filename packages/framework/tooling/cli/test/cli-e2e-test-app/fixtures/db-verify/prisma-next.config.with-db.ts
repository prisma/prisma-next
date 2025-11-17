import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './contract';

// This config includes driver and db.url
// The db.url will be replaced at runtime in tests
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
    url: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
