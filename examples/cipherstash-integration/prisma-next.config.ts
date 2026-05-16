import 'dotenv/config';
import cipherstash from '@prisma-next/extension-cipherstash/control';
import { defineConfig } from '@prisma-next/postgres/config';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required — set it in .env (see .env.example) before running prisma-next CLI commands.',
  );
}

export default defineConfig({
  contract: './src/prisma/contract.prisma',
  extensions: [cipherstash],
  migrations: { dir: 'migrations' },
  db: { connection: databaseUrl },
});
