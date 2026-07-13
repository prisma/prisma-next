import betterAuthPack from '@prisma-next/extension-better-auth/pack';
import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './src/prisma/contract.prisma',
  extensions: [betterAuthPack],
  db: {
    connection: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/better_auth_example',
  },
});
