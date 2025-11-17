import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

// Manually create config without using defineConfig to test error path
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    // Missing output and types to test error path
  },
};
