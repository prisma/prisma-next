import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/*.config.ts',
        '**/exports/**',
        '**/plugins/types.ts', // Types-only file
        'core/**', // Core subdirectory
      ],
      thresholds: {
        lines: 80,
        branches: 85,
        functions: 94,
        statements: 90,
      },
    },
  },
});
