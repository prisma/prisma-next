import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: timeouts.default,
    /**
     * Set hookTimeout to match the timeout used in beforeAll hooks that spin up ppg-dev.
     * Vitest's default hookTimeout is 10000ms, which caps hook timeouts even when a higher
     * value is passed to beforeAll. Setting this ensures hooks can use the full timeout
     * (which respects TEST_TIMEOUT_MULTIPLIER in CI).
     */
    hookTimeout: timeouts.spinUpPpgDev,
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
        lines: 62,
        branches: 48,
        functions: 80,
        statements: 62,
      },
    },
  },
});
