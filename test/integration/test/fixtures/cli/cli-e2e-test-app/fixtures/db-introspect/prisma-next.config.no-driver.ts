import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

// This config does not include driver
// Manually create config without defineConfig to bypass validation (testing error case)
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  // driver is missing - this is what we're testing
  extensions: [],
  contract: {
    source: async () => ({ ok: true, value: contract }),
    output: 'output/contract.json',
  },
  db: {
    connection: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
};
