import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
});
