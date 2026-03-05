import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  extensionPacks: [pgvector],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    connection: process.env['DATABASE_URL']!,
  },
});
