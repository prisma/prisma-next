import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './multi-branch-contract/target.prisma',
  db: {
    connection: 'postgresql://multi-branch:multi-branch@localhost:5432/multi-branch',
  },
  migrations: {
    dir: './migration-fixtures/multi-branch',
  },
});
