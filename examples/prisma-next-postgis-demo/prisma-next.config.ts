import 'dotenv/config';
import postgis from '@prisma-next/extension-postgis/control';
import { defineConfig } from '@prisma-next/postgres/config';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required (load it from .env or your environment)');
}

export default defineConfig({
  contract: './src/prisma/contract.prisma',
  extensions: [postgis],
  db: { connection: databaseUrl },
});
