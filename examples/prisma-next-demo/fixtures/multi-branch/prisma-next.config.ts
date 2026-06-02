import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './contract.prisma',
  db: {
    connection: 'postgresql://multi-branch:multi-branch@localhost:5432/multi-branch',
  },
  migrations: {
    dir: './migrations',
  },
});
