import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql, { assemblePslInterpretationContributions } from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { extensionPacks } from './packs';

const pslInterpretationContributions = assemblePslInterpretationContributions([
  postgres,
  postgresAdapter,
  ...extensionPacks,
]);

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks,
  contract: prismaContract('./schema.prisma', {
    output: 'output/contract.json',
    target: postgres,
    scalarTypeDescriptors: pslInterpretationContributions.scalarTypeDescriptors,
    controlMutationDefaults: {
      defaultFunctionRegistry: pslInterpretationContributions.defaultFunctionRegistry,
      generatorDescriptors: pslInterpretationContributions.generatorDescriptors,
    },
    composedExtensionPacks: extensionPacks.map((pack) => pack.id),
  }),
});
