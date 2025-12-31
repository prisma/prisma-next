import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  db: {
    url: 'postgres://postgres:postgres@127.0.0.1:61294/template1?sslmode=disable',
  },
  contract: {
    source: './contract.ts',
    output: './src/prisma/contract.json',
  },
});
