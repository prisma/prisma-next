import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './contract';

// Manually create config without using defineConfig to test error path
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: contract,
    // Missing output and types to test error path
  },
};
