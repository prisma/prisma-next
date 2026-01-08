import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['dist/', '**/*.test.ts', '**/*.config.ts'],
      thresholds: {
        lines: 81,
        branches: 75,
        functions: 92,
        statements: 80,
      },
    },
  },
});
