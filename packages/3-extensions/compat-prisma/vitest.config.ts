import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
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
        lines: 89,
        branches: 79,
        functions: 100,
        statements: 89,
      },
    },
  },
});
