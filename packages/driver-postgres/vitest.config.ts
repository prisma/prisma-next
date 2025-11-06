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
        ],
        thresholds: {
          lines: 84,
          branches: 85,
          functions: 100,
          statements: 84,
        },
      },
  },
});

