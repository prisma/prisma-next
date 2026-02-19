import { prismaVitePlugin } from '@prisma-next/vite-plugin-contract-emit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    prismaVitePlugin('prisma-next.arktype.config.ts'),
    prismaVitePlugin('prisma-next.zod.config.ts'),
    prismaVitePlugin('prisma-next.ids.config.ts'),
  ],
});
