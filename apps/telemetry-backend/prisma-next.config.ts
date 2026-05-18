import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './src/prisma/contract.prisma',
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from environment
    connection: process.env['DATABASE_URL']!,
  },
});
