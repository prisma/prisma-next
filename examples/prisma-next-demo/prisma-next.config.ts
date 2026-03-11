import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql, { assemblePslInterpretationContributions } from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';

const extensionPacks = [pgvector];
const pslContributions = assemblePslInterpretationContributions([
  postgres,
  postgresAdapter,
  ...extensionPacks,
]);

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  extensionPacks,
  contract: prismaContract('./prisma/schema.prisma', {
    output: 'src/prisma/contract.json',
    target: postgres,
    scalarTypeDescriptors: pslContributions.scalarTypeDescriptors,
    controlMutationDefaults: {
      defaultFunctionRegistry: pslContributions.defaultFunctionRegistry,
      generatorDescriptors: pslContributions.generatorDescriptors,
    },
    composedExtensionPacks: extensionPacks.map((pack) => pack.id),
  }),
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    connection: process.env['DATABASE_URL']!,
  },
});
