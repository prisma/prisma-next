import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { ok } from '@prisma-next/utils/result';

const configDir = dirname(fileURLToPath(import.meta.url));
const contractPath = './contract.prisma';

function createContract(options: {
  readonly includeName: boolean;
  readonly includeNickname: boolean;
}) {
  return defineContract({
    family: sqlFamily,
    target: postgresPack,
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          ...(options.includeName ? { name: field.column(textColumn).optional() } : {}),
          ...(options.includeNickname ? { nickname: field.column(textColumn).optional() } : {}),
        },
      }).sql({ table: 'user' }),
    },
  });
}

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: {
    source: async () => {
      const schema = await readFile(resolve(configDir, contractPath), 'utf-8');
      return ok(
        createContract({
          includeName: schema.includes('name'),
          includeNickname: schema.includes('nickname'),
        }),
      );
    },
    output: 'output/contract.json',
    watchInputs: [contractPath],
  },
});
