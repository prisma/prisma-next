import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
