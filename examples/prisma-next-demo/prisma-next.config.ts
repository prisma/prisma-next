import 'dotenv/config';
import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
