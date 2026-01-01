import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

// Types-only package: SQL Schema IR types for schema introspection and verification
// No test files exist, but coverage config is included for consistency with other packages
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
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});

