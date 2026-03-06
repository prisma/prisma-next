import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

// This config includes db.connection and family with readMarker but no driver
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [],
  contract: typescriptContract(contract, 'output/contract.json'),
  db: {
    connection: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
