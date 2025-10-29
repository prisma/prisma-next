import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@prisma-next/runtime': path.resolve(
        __dirname,
        '../../packages/runtime/src/exports/index.ts',
      ),
      '@prisma-next/adapter-postgres/adapter': path.resolve(
        __dirname,
        '../../packages/adapter-postgres/src/exports/adapter.ts',
      ),
      '@prisma-next/driver-postgres': path.resolve(
        __dirname,
        '../../packages/driver-postgres/src/exports/index.ts',
      ),
      '@prisma-next/sql/sql': path.resolve(__dirname, '../../packages/sql/src/exports/sql.ts'),
      '@prisma-next/sql/schema': path.resolve(
        __dirname,
        '../../packages/sql/src/exports/schema.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
