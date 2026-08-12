import 'dotenv/config';
import paradedb from '@prisma-next/extension-paradedb/control';
import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './prisma/contract.ts',
  output: './src/prisma',
  extensions: [paradedb],
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    connection: process.env['DATABASE_URL']!,
  },
});
