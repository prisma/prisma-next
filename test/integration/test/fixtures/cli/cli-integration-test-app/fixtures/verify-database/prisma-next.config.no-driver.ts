import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig, typescriptContract } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

// This config includes db.connection and family with readMarker but no driver
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: typescriptContract(contract, 'output/contract.json'),
  db: {
    connection: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
