import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Note: do not change to 'threads', it will cause the failure
    // `TypeError: process.chdir() is not supported in workers`.
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    env: {
      CI: 'true',
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
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
