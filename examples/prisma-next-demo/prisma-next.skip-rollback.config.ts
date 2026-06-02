import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './skip-rollback-contract/c1.prisma',
  db: {
    connection: 'postgresql://skip-rollback:skip-rollback@localhost:5432/skip-rollback',
  },
  migrations: {
    dir: './migration-fixtures/skip-rollback',
  },
});
