import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: './schema.prisma',
    output: 'output/contract.json',
  },
  db: {
    connection: '{{DB_URL}}',
  },
});
