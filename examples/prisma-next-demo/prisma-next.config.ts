import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/targets-postgres/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [pgvector],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
});
