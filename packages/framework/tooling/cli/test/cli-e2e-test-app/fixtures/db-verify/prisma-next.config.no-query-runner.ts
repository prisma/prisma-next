import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { SqlFamilyContext } from '@prisma-next/family-sql/context';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

// This config includes db.url but no driver
export default defineConfig<SqlFamilyContext>({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    url: '{{DB_URL}}', // Placeholder to be replaced in tests
  },
});
