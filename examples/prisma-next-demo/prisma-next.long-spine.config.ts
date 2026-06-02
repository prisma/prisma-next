import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './long-spine-contract/everything.prisma',
  db: {
    connection: 'postgresql://long-spine:long-spine@localhost:5432/long-spine',
  },
  migrations: {
    dir: './migration-fixtures/long-spine',
  },
});
