import 'dotenv/config';
import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    connection: process.env['DATABASE_URL']!,
  },
});
