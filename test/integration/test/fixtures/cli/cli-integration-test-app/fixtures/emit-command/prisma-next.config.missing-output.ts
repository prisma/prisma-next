import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { ok } from '@prisma-next/utils/result';
import { contract } from './contract';

// Manually create config without using defineConfig to test error path
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: async () => ok(contract),
    // Missing output to test error path
  },
};
