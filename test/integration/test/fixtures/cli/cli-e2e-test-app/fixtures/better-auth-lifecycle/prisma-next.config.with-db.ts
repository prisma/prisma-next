import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import betterAuthPack from '@prisma-next/extension-better-auth/pack';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

// A consuming app that adds the better-auth pack to extensionPacks.
// The db.connection placeholder is replaced at runtime in tests.
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [betterAuthPack],
  contract: {
    source: {
      load: async () => ({ ok: true, value: contract }),
    },
    output: 'output/contract.json',
  },
  db: {
    connection: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
