import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    environment: 'node',
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
        '**/index.ts', // Re-export file
        '**/types.ts', // Types-only file
        '**/exports/**', // Re-export files
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
