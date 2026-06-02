import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './converging-branches-contract/union.prisma',
  db: {
    connection:
      'postgresql://converging-branches:converging-branches@localhost:5432/converging-branches',
  },
  migrations: {
    dir: './migration-fixtures/converging-branches',
  },
});
