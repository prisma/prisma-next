import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import pgvectorPack from '@prisma-next/extension-pgvector/pack';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  extensionPacks: [pgvector],
  contract: prismaContract('./prisma/schema.prisma', {
    output: 'src/prisma/contract.json',
    composedExtensionPacks: ['pgvector'],
    extensionPacks: { pgvector: pgvectorPack },
    capabilitySources: [postgresAdapter, pgvectorPack],
  }),
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    connection: process.env['DATABASE_URL']!,
  },
});
