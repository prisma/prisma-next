import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const contractSrc = resolve(__dirname, '../1-core/contract/src/exports');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@prisma-next\/sql-contract\/(.+)$/,
        replacement: `${contractSrc}/$1.ts`,
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
