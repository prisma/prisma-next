import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgis from '@prisma-next/extension-postgis/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required (load it from .env or your environment)');
}

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  extensionPacks: [postgis],
  contract: prismaContract('./src/prisma/schema.prisma', {
    output: 'src/prisma/contract.json',
    target: postgres,
  }),
  db: {
    connection: databaseUrl,
  },
});
