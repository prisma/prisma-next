import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  extensions: [pgvector],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    url: process.env['DATABASE_URL']!,
  },
});
