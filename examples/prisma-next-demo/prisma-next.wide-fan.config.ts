import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './wide-fan-contract/settings.prisma',
  db: {
    connection: 'postgresql://wide-fan:wide-fan@localhost:5432/wide-fan',
  },
  migrations: {
    dir: './migration-fixtures/wide-fan',
  },
});
