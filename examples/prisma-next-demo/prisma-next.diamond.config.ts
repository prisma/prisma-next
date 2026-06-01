import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './diamond-contract/c5.prisma',
  db: {
    connection: 'postgresql://diamond:diamond@localhost:5432/diamond',
  },
  migrations: {
    dir: './migration-fixtures/diamond',
  },
});
