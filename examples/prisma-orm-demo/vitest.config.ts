import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@prisma-next/sql/sql': path.resolve(__dirname, '../../packages/sql/src/exports/sql.ts'),
      '@prisma-next/sql/schema': path.resolve(__dirname, '../../packages/sql/src/exports/schema.ts'),
      '@prisma-next/sql/types': path.resolve(__dirname, '../../packages/sql/src/exports/types.ts'),
    },
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

