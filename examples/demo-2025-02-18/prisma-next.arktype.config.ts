import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './prisma/arktype-json/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  contract: {
    source: contract,
    output: 'prisma/arktype-json/contract.json',
  },
  db: {
    connection: process.env['DATABASE_URL_ARKTYPE_JSON'],
  },
});
