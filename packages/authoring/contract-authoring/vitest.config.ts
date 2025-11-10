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
        '**/builder-state.ts', // Types-only file
        '**/types.ts', // Types-only file
        '**/index.ts', // Re-export file
      ],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 93,
        statements: 90,
      },
    },
  },
});
