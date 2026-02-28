import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig, prismaContract } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { notOk, ok } from '@prisma-next/utils/result';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: prismaContract(
    './schema.prisma',
    async ({ schema, schemaPath }) => {
      if (!schema.includes('model User')) {
        return notOk({
          summary: 'PSL provider failed',
          diagnostics: [
            {
              code: 'PSL_INVALID_MODEL',
              message: 'Expected model User in schema',
              sourceId: schemaPath,
            },
          ],
        });
      }
      return ok(contract);
    },
    'output/contract.json',
  ),
});
