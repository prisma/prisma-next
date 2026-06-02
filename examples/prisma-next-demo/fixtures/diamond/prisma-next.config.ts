import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './contract.prisma',
  db: {
    connection: 'postgresql://diamond:diamond@localhost:5432/diamond',
  },
  migrations: {
    dir: './migrations',
  },
});
