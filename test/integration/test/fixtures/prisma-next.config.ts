import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: {
    source: {
      authoritativeInputs: { kind: 'moduleGraph' },
      load: async () => ({ ok: true, value: contract }),
    },
    output: 'contract.json',
  },
});
