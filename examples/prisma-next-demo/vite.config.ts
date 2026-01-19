import { prismaVitePlugin } from '@prisma-next/vite-plugin-contract-emit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [prismaVitePlugin()],
});
