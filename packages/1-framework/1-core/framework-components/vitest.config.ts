import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dist = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@prisma-next/mongo-contract': dist(
        '../../../2-mongo-family/1-foundation/mongo-contract/dist/index.mjs',
      ),
      '@prisma-next/sql-contract/types': dist('../../../2-sql/1-core/contract/dist/types.mjs'),
      '#element-coordinates/postgres-schema': dist(
        '../../../3-targets/3-targets/postgres/dist/types.mjs',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/*.config.ts',
        '**/exports/**',
      ],
    },
  },
});
