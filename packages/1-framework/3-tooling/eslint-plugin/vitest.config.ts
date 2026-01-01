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
        lines: 70,
        branches: 70,
        functions: 80,
        statements: 70,
      },
    },
  },
});
