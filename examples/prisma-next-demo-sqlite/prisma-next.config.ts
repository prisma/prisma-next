import 'dotenv/config';
import { defineConfig } from '@prisma-next/sqlite/config';

export default defineConfig({
  contract: './prisma/contract.ts',
  db: {
    connection: process.env['SQLITE_PATH'] ?? './demo.db',
  },
});
