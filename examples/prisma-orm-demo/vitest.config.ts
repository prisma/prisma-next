import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@prisma-next/sql-query-query/sql': path.resolve(
        __dirname,
        '../../packages/sql-query/src/exports/sql.ts',
      ),
      '@prisma-next/sql-query-query/schema': path.resolve(
        __dirname,
        '../../packages/sql-query/src/exports/schema.ts',
      ),
      '@prisma-next/sql-query-query/types': path.resolve(
        __dirname,
        '../../packages/sql-query/src/exports/types.ts',
      ),
    },
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
  },
});
