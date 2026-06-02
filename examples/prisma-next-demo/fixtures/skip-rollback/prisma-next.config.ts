import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './contract.prisma',
  db: {
    connection: 'postgresql://skip-rollback:skip-rollback@localhost:5432/skip-rollback',
  },
  migrations: {
    dir: './migrations',
  },
});
