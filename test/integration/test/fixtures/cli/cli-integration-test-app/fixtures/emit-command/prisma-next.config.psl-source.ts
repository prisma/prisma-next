import { readFile } from 'node:fs/promises';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { notOk, ok } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: {
    source: async () => {
      const schema = await readFile(resolve('./schema.prisma'), 'utf-8');
      if (!schema.includes('model User')) {
        return notOk({
          summary: 'PSL provider failed',
          diagnostics: [
            {
              code: 'PSL_INVALID_MODEL',
              message: 'Expected model User in schema',
              sourceId: 'schema.prisma',
            },
          ],
        });
      }
      return ok(contract);
    },
    output: 'output/contract.json',
  },
});
