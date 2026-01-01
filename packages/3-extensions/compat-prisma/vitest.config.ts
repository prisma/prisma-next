import { timeouts } from '@prisma-next/test-utils';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
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
        lines: 62,
        branches: 48,
        functions: 80,
        statements: 62,
      },
    },
  },
});
