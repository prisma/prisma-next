import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

// This config includes driver and db.connection
// The db.connection will be replaced at runtime in tests
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: async () => ({ ok: true, value: contract }),
    output: 'output/contract.json',
  },
  db: {
    connection: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
