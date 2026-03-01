import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { ContractIR } from '@prisma-next/contract/ir';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

const fixtureContract: ContractIR = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  models: {},
  relations: {},
  storage: {},
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
};

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  db: {
    connection: '{{DB_URL}}',
  },
  contract: {
    source: async () => ({ ok: true, value: fixtureContract }),
    output: './src/prisma/contract.json',
  },
});
