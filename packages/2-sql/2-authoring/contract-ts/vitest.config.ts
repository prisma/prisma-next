import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const contractSrc = resolve(__dirname, '../../1-core/contract/src/exports');

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
      thresholds: {
        lines: 95,
        branches: 94,
        functions: 95,
        statements: 95,
      },
    },
  },
});
