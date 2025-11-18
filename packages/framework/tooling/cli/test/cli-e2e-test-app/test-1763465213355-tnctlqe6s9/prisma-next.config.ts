import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
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
    url: 'postgres://postgres:postgres@127.0.0.1:54203/postgres?connection_limit=1&connect_timeout=0&max_idle_connection_lifetime=0&pool_timeout=0&socket_timeout=0&sslmode=disable', // Placeholder to be replaced in tests
  },
});
